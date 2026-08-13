import pytest
from pydantic import ValidationError

from matchpoint_api.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    OtpRequest,
    ResetPasswordRequest,
    VerifyOtpRequest,
)

LOGIN = {"email": "mike@example.com", "password": "a-good-password"}
VERIFY = {"email": "mike@example.com", "otp": "123456"}
RESET = {"email": "mike@example.com", "otp": "123456", "new_password": "a-new-password"}


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


def test_a_valid_otp_request_parses() -> None:
    assert OtpRequest.model_validate({"email": "mike@example.com"}).email == "mike@example.com"


def test_the_otp_request_email_is_stripped_and_validated() -> None:
    assert OtpRequest.model_validate({"email": "  mike@example.com "}).email == "mike@example.com"
    with pytest.raises(ValidationError):
        OtpRequest.model_validate({"email": "not-an-address"})


def test_a_valid_verification_parses() -> None:
    request = VerifyOtpRequest.model_validate(VERIFY)

    assert request.email == "mike@example.com"
    assert request.otp.get_secret_value() == "123456"


@pytest.mark.parametrize("otp", ["12345", "1234567"])
def test_a_code_of_the_wrong_length_is_rejected(otp: str) -> None:
    """Exactly six, both bounds: the length is the one shape fact the spec can carry,
    so the form enforces it without a hand-written twin."""
    with pytest.raises(ValidationError):
        VerifyOtpRequest.model_validate(VERIFY | {"otp": otp})


def test_a_non_digit_code_is_accepted_by_the_schema() -> None:
    """Digits-only is deliberately not the schema's line: a six-character non-code is
    a wrong code for the route to 400, not a malformed request — the codes we mint are
    digits, so nothing real is lost, and the 400 keeps every failure one fact."""
    assert VerifyOtpRequest.model_validate(VERIFY | {"otp": "abcdef"}).otp is not None


def test_the_repr_never_contains_the_code() -> None:
    assert "123456" not in repr(VerifyOtpRequest.model_validate(VERIFY))


def test_a_valid_forgot_password_request_parses() -> None:
    parsed = ForgotPasswordRequest.model_validate({"email": "mike@example.com"})

    assert parsed.email == "mike@example.com"


def test_the_forgot_password_email_is_stripped_and_validated() -> None:
    stripped = ForgotPasswordRequest.model_validate({"email": "  mike@example.com "})
    assert stripped.email == "mike@example.com"
    with pytest.raises(ValidationError):
        ForgotPasswordRequest.model_validate({"email": "not-an-address"})


def test_a_valid_reset_parses() -> None:
    request = ResetPasswordRequest.model_validate(RESET)

    assert request.email == "mike@example.com"
    assert request.otp.get_secret_value() == "123456"
    assert request.new_password.get_secret_value() == "a-new-password"


@pytest.mark.parametrize("otp", ["12345", "1234567"])
def test_a_reset_code_of_the_wrong_length_is_rejected(otp: str) -> None:
    with pytest.raises(ValidationError):
        ResetPasswordRequest.model_validate(RESET | {"otp": otp})


def test_a_new_password_below_the_floor_is_rejected() -> None:
    """Unlike login's password, this one is *new*, so sign-up's floor applies: a reset
    must not become the way to enrol a password sign-up would have refused."""
    with pytest.raises(ValidationError):
        ResetPasswordRequest.model_validate(RESET | {"new_password": "x" * 7})
    at_the_floor = ResetPasswordRequest.model_validate(RESET | {"new_password": "x" * 8})
    assert at_the_floor.new_password is not None


def test_a_new_password_over_the_ceiling_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ResetPasswordRequest.model_validate(RESET | {"new_password": "x" * 129})


def test_the_new_password_is_not_stripped() -> None:
    """A space is a legitimate password character; silently trimming one would enrol
    a different credential than the coach chose."""
    request = ResetPasswordRequest.model_validate(RESET | {"new_password": " padded password "})

    assert request.new_password.get_secret_value() == " padded password "


def test_the_repr_never_contains_the_new_password_or_code() -> None:
    request = ResetPasswordRequest.model_validate(RESET)

    assert "a-new-password" not in repr(request)
    assert "123456" not in repr(request)
