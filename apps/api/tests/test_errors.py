"""Unit tests for validation-error redaction — no fixtures, no database.

The route-level proof that the handler is actually wired onto the app lives in
`tests/routers/test_coaches.py`; these cover the shapes FastAPI can hand it.
"""

import importlib
import json
import pkgutil

from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, SecretStr

from matchpoint_api import schemas
from matchpoint_api.errors import REDACTED, SECRET_FIELDS, validation_error_response


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
