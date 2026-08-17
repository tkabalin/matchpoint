"""Error-response shaping, and specifically keeping submitted secrets out of a 422.

FastAPI reports a rejected body by echoing what was submitted back in `detail[].input`,
which is a useful thing to tell a client — except where the value is a password. A
rejected sign-up otherwise reflects the coach's chosen credential into a response body,
and from there into browser devtools, into any proxy log that records bodies, and into
whatever the web app reports client-side errors to. That the password failed the schema
does not make it a throwaway: a coach who fixes their email and retries with the same
password has just published a live credential.

Handled here rather than in the schema, because the leak belongs to FastAPI's error shape
and not to anything the schema asked for. `SecretStr` already keeps the value out of
reprs, tracebacks and logs, and can do nothing about an error it never sees.

The catch-all 500 below is the same job at the other end: whatever went wrong, the client
is told only that something did, and the traceback stays in the log.
"""

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request

from matchpoint_api.headers import apply_security_headers
from matchpoint_api.logs import REQUEST_ID_HEADER

# The field names whose submitted value must never be echoed. `tests/test_errors.py`
# fails if a schema grows a `SecretStr` field that is not named here — the failure
# mode is silent otherwise.
SECRET_FIELDS = frozenset({"password", "otp", "new_password"})

REDACTED = "[redacted]"


def _redact(value: Any) -> Any:
    """Replace every secret field inside a submitted value, at any depth.

    Recursive because `input` is not always the offending field's own value: an error on
    one field reports the whole enclosing object as its input, so a sign-up that merely
    omits the email echoes the password it did send.
    """
    if isinstance(value, dict):
        return {
            key: REDACTED if key in SECRET_FIELDS else _redact(item)
            for key, item in value.items()  # pyright: ignore[reportUnknownVariableType]
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]  # pyright: ignore[reportUnknownVariableType]
    return value


def _scrub(error: dict[str, Any]) -> dict[str, Any]:
    """Redact one validation error's `input`, leaving the rest of it untouched.

    `loc` is checked as well as the value, because an error on the secret field itself
    reports the bare string it was given, with no key left to recognise it by.
    """
    if "input" not in error:
        return error
    loc: Any = error.get("loc") or ()
    # An unknown key carries its own value as the input, under a name SECRET_FIELDS
    # cannot classify: a misspelled `password`, or a `confirm_password` sent whole.
    # `loc` still names the key, so redacting costs the caller nothing.
    if error.get("type") == "extra_forbidden" or (loc and loc[-1] in SECRET_FIELDS):
        return {**error, "input": REDACTED}
    return {**error, "input": _redact(error["input"])}


def validation_error_response(exc: RequestValidationError) -> JSONResponse:
    """The 422 body, shaped exactly as FastAPI's own handler shapes it but redacted.

    The shape matters: FastAPI auto-declares every route's 422 as
    `HTTPValidationError`, so the generated TypeScript client reads `detail` as a list of
    errors. Anything else here would be a body the client cannot parse.
    """
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder([_scrub(dict(error)) for error in exc.errors()])},
    )


# Static, and the only thing an unhandled exception ever tells the client. What went wrong
# is a message written for us, not for a coach: a stack frame, a table name, a provider's
# refusal. `ErrorDetail`'s shape so the web app reads it like any other error.
UNEXPECTED = "Something went wrong, please try again"


async def unhandled_exception_response(request: Request, _exc: Exception) -> JSONResponse:
    """The 500 body for an exception nothing else answered for.

    Starlette runs this above every middleware, so the response has to carry the headers
    they would have added: the id, which is what ties this answer to the logged traceback,
    and the security set, which no response should be missing.
    """
    response = JSONResponse(status_code=500, content={"detail": UNEXPECTED})
    request_id = getattr(request.state, "request_id", None)
    if request_id is not None:
        response.headers[REQUEST_ID_HEADER] = request_id
    apply_security_headers(response)
    return response
