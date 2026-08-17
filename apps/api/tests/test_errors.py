"""What the client is told when a request fails: redaction, and the catch-all 500.

The redaction tests take no fixtures and no database, covering the shapes FastAPI can hand
the handler; the route-level proof that it is wired onto the app lives in
`tests/routers/test_coaches.py`. The catch-all has no router to prove it that way, so its
tests build an app with a route that raises and read the response off the wire.
"""

import importlib
import json
import pkgutil

from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, SecretStr
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from matchpoint_api import schemas
from matchpoint_api.errors import REDACTED, SECRET_FIELDS, UNEXPECTED, validation_error_response
from matchpoint_api.logs import REQUEST_ID_HEADER
from matchpoint_api.main import create_app
from tests.conftest import INTERNAL_MESSAGE, ORIGIN_HEADERS, TEST_ORIGIN, crashing_client


def detail(*errors: dict[str, object]) -> list[dict[str, object]]:
    """Run errors through the handler and hand back the `detail` it produced."""
    response = validation_error_response(RequestValidationError(list(errors)))
    return json.loads(bytes(response.body))["detail"]


def secret_field_names() -> set[str]:
    """Every `SecretStr` field on every schema, found rather than listed.

    Walks the package because the point is to catch a schema this test does not know
    about: a login or password-reset body added later has to be covered by SECRET_FIELDS
    without anyone remembering to come back here.
    """
    names: set[str] = set()
    for module_info in pkgutil.iter_modules(schemas.__path__):
        module = importlib.import_module(f"{schemas.__name__}.{module_info.name}")
        for value in vars(module).values():
            if isinstance(value, type) and issubclass(value, BaseModel):
                names |= {
                    name
                    for name, field in value.model_fields.items()
                    if field.annotation is SecretStr
                }
    return names


def test_a_secret_field_is_the_only_thing_redacted() -> None:
    """The rest of the error is left exactly as FastAPI produced it. `msg`, `type` and
    `loc` are what a form shows the coach, so redacting must not cost them."""
    errors = detail(
        {"type": "too_short", "loc": ["body", "password"], "msg": "too short", "input": "short"}
    )

    assert errors == [
        {"type": "too_short", "loc": ["body", "password"], "msg": "too short", "input": REDACTED}
    ]


def test_a_password_alongside_another_fields_error_is_redacted() -> None:
    """The leak a check on `loc` alone would miss: the error is on the email, and FastAPI
    reports the whole submitted body as its input — password included."""
    errors = detail(
        {
            "type": "missing",
            "loc": ["body", "email"],
            "msg": "Field required",
            "input": {"display_name": "Coach Mike", "password": "a-good-password"},
        }
    )

    assert errors[0]["input"] == {"display_name": "Coach Mike", "password": REDACTED}


def test_a_password_nested_below_the_reported_field_is_redacted() -> None:
    """Redaction goes all the way down, so a body nesting a password deeper than anything
    here anticipates is covered on the day it is added."""
    errors = detail(
        {
            "type": "missing",
            "loc": ["body"],
            "msg": "Field required",
            "input": {"coaches": [{"password": "a-good-password"}]},
        }
    )

    assert errors[0]["input"] == {"coaches": [{"password": REDACTED}]}


def test_an_unknown_keys_value_is_redacted() -> None:
    """`extra="forbid"` reports the rejected key's own value, and an unknown key can hold
    a secret under a name SECRET_FIELDS has no way to recognise: a misspelled `password`,
    or a `confirm_password` a form sent whole."""
    errors = detail(
        {
            "type": "extra_forbidden",
            "loc": ["body", "confirm_password"],
            "msg": "Extra inputs are not permitted",
            "input": "a-good-password",
        }
    )

    assert errors[0]["input"] == REDACTED
    assert errors[0]["loc"] == ["body", "confirm_password"]


def test_an_error_carrying_no_input_is_passed_through() -> None:
    """Not every validation error has an `input`, and reading one that is absent would
    turn a 422 into a 500."""
    errors = detail({"type": "missing", "loc": ["body", "email"], "msg": "Field required"})

    assert errors == [{"type": "missing", "loc": ["body", "email"], "msg": "Field required"}]


def test_a_field_that_is_not_secret_keeps_its_input() -> None:
    """Dropping every `input` would be the easier fix and the wrong one: the echoed value
    is what tells a client which value of the several it sent was rejected."""
    errors = detail(
        {
            "type": "string_too_long",
            "loc": ["body", "display_name"],
            "msg": "too long",
            "input": "a very long name",
        }
    )

    assert errors[0]["input"] == "a very long name"


def test_every_secret_field_in_the_schemas_is_named_in_secret_fields() -> None:
    """The tripwire. A new `SecretStr` field leaks silently — the response is a valid 422
    either way — so nothing but this test would report it."""
    assert secret_field_names() <= SECRET_FIELDS


def test_an_unhandled_exception_answers_a_readable_json_body() -> None:
    """Without this the body is Starlette's plain text, which the generated client throws
    as a bare string: no `detail` to read, so every form falls back to its own guess at
    what went wrong."""
    response = crashing_client().get("/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"detail": UNEXPECTED}


def test_an_unhandled_exception_tells_the_client_nothing_about_itself() -> None:
    """The security half. A generic body is only generic while nobody thinks to be helpful
    with the exception they have in hand."""
    body = crashing_client().get("/boom").text

    assert INTERNAL_MESSAGE not in body
    assert "RuntimeError" not in body
    assert "Traceback" not in body


def test_the_500_carries_the_request_id_that_logged_the_traceback() -> None:
    """What makes the generic body actionable: the id the coach can quote is the id on the
    log line holding the real exception. Set here rather than by the middleware, which
    never gets its response back."""
    response = crashing_client().get("/boom", headers={REQUEST_ID_HEADER: "crashcorrelation"})

    assert response.headers[REQUEST_ID_HEADER] == "crashcorrelation"


def test_a_failure_above_the_logging_middleware_is_answered_too() -> None:
    """Why this is a handler and not another middleware: a middleware outside the one that
    binds the request id can raise too, and that failure needs the same generic body. All
    it costs is the header, since the id was never bound.
    """

    class Explodes(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
            raise RuntimeError(INTERNAL_MESSAGE)

    app = create_app()
    # Added last, so outermost: nothing this app is asked for reaches the middleware that
    # would have bound an id, let alone a route.
    app.add_middleware(Explodes)

    with TestClient(
        app, base_url=TEST_ORIGIN, headers=ORIGIN_HEADERS, raise_server_exceptions=False
    ) as client:
        response = client.get("/health")

    assert response.status_code == 500
    assert response.json() == {"detail": UNEXPECTED}
    assert INTERNAL_MESSAGE not in response.text
    assert REQUEST_ID_HEADER not in response.headers
