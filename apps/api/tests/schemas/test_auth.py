import pytest
from pydantic import ValidationError

from matchpoint_api.schemas.auth import LoginRequest

LOGIN = {"email": "mike@example.com", "password": "a-good-password"}


def test_a_valid_login_parses() -> None:
    request = LoginRequest.model_validate(LOGIN)

    assert request.email == "mike@example.com"
    assert request.password.get_secret_value() == "a-good-password"


def test_the_email_is_stripped_and_validated() -> None:
    assert LoginRequest.model_validate(LOGIN | {"email": "  mike@example.com "}).email == (
        "mike@example.com"
    )
    with pytest.raises(ValidationError):
        LoginRequest.model_validate(LOGIN | {"email": "not-an-address"})


def test_a_password_below_the_sign_up_floor_is_accepted() -> None:
    """Deliberately no min_length, unlike CoachCreate: the floor is sign-up policy for
    new passwords, and enforcing it at login would lock out any coach who enrolled
    before a later raise of it. A wrong short password fails verification instead."""
    assert LoginRequest.model_validate(LOGIN | {"password": "x"}).password is not None


def test_a_password_over_the_ceiling_is_rejected() -> None:
    """The ceiling is the same body bound sign-up applies — nothing longer than what
    could ever have been enrolled needs to reach Argon2."""
    with pytest.raises(ValidationError):
        LoginRequest.model_validate(LOGIN | {"password": "x" * 129})


def test_the_password_is_not_stripped() -> None:
    """A space is a legitimate password character; silently trimming one would turn
    the correct password into a wrong one."""
    request = LoginRequest.model_validate(LOGIN | {"password": " padded password "})

    assert request.password.get_secret_value() == " padded password "


def test_the_repr_never_contains_the_password() -> None:
    request = LoginRequest.model_validate(LOGIN)

    assert "a-good-password" not in repr(request)
