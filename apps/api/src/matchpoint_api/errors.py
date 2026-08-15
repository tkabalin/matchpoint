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
"""

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

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
