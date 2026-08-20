import pytest
from pydantic import ValidationError

from matchpoint_api.schemas.auth import (
    USERNAME_MAX_LENGTH,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    OtpRequest,
    PlayerChangePasswordRequest,
    PlayerLoginRequest,
    ResetPasswordRequest,
    VerifyOtpRequest,
    VerifyResetCodeRequest,
)

LOGIN = {"email": "mike@example.com", "password": "a-good-password"}
VERIFY = {"email": "mike@example.com", "otp": "123456"}
VERIFY_RESET = {"email": "mike@example.com", "otp": "123456"}
RESET = {"email": "mike@example.com", "new_password": "a-new-password"}
CHANGE = {"password": "a-good-password", "new_password": "a-new-password"}


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


def test_a_valid_reset_code_verification_parses() -> None:
    request = VerifyResetCodeRequest.model_validate(VERIFY_RESET)

    assert request.email == "mike@example.com"
    assert request.otp.get_secret_value() == "123456"


@pytest.mark.parametrize("otp", ["12345", "1234567"])
def test_a_reset_code_of_the_wrong_length_is_rejected(otp: str) -> None:
    with pytest.raises(ValidationError):
        VerifyResetCodeRequest.model_validate(VERIFY_RESET | {"otp": otp})


def test_the_reset_code_verification_repr_never_contains_the_code() -> None:
    assert "123456" not in repr(VerifyResetCodeRequest.model_validate(VERIFY_RESET))


def test_a_valid_reset_parses() -> None:
    request = ResetPasswordRequest.model_validate(RESET)

    assert request.email == "mike@example.com"
    assert request.new_password.get_secret_value() == "a-new-password"


def test_a_reset_carrying_a_code_is_rejected() -> None:
    """The field moved to verify-reset-code (#149), and RequestModel forbids extras, so
    a caller still sending it is told rather than having it silently ignored."""
    with pytest.raises(ValidationError):
        ResetPasswordRequest.model_validate(RESET | {"otp": "123456"})


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


def test_the_repr_never_contains_the_new_password() -> None:
    assert "a-new-password" not in repr(ResetPasswordRequest.model_validate(RESET))


def test_a_valid_change_parses() -> None:
    """No email: the session says whose password this is."""
    request = ChangePasswordRequest.model_validate(CHANGE)

    assert request.password.get_secret_value() == "a-good-password"
    assert request.new_password.get_secret_value() == "a-new-password"


def test_only_the_new_password_takes_the_sign_up_floor() -> None:
    """The two fields carry different bounds deliberately, and swapping them is invisible
    to every other test: a floor on the current password locks out a coach who enrolled
    under an older one, and none on the new one makes this the way past sign-up's policy."""
    assert ChangePasswordRequest.model_validate(CHANGE | {"password": "x"}).password is not None
    with pytest.raises(ValidationError):
        ChangePasswordRequest.model_validate(CHANGE | {"new_password": "x" * 7})


PLAYER_LOGIN = {"username": "kbltho001", "password": "abcd-efgh-jkmn"}
PLAYER_CHANGE = {"password": "abcd-efgh-jkmn", "new_password": "a-new-password"}


def test_a_valid_player_login_parses() -> None:
    request = PlayerLoginRequest.model_validate(PLAYER_LOGIN)

    assert request.username == "kbltho001"
    assert request.password.get_secret_value() == "abcd-efgh-jkmn"


def test_the_username_is_stripped_and_bounded() -> None:
    """Stripped because it arrives typed off paper; bounded at the column's width
    because anything longer can only be a wrong username, kept away from the query."""
    stripped = PlayerLoginRequest.model_validate(PLAYER_LOGIN | {"username": "  kbltho001 "})
    assert stripped.username == "kbltho001"
    with pytest.raises(ValidationError):
        PlayerLoginRequest.model_validate(
            PLAYER_LOGIN | {"username": "x" * (USERNAME_MAX_LENGTH + 1)}
        )


def test_the_player_password_has_no_floor_and_keeps_the_ceiling() -> None:
    """Login's bounds for login's reasons: a floor would lock out a player whose minted
    password predates a later format change, and the ceiling spares Argon2."""
    assert PlayerLoginRequest.model_validate(PLAYER_LOGIN | {"password": "x"}).password is not None
    with pytest.raises(ValidationError):
        PlayerLoginRequest.model_validate(PLAYER_LOGIN | {"password": "x" * 129})


def test_the_player_login_repr_never_contains_the_password() -> None:
    assert "abcd-efgh-jkmn" not in repr(PlayerLoginRequest.model_validate(PLAYER_LOGIN))


def test_a_valid_player_change_parses() -> None:
    """No username: the session says whose password this is."""
    request = PlayerChangePasswordRequest.model_validate(PLAYER_CHANGE)

    assert request.password.get_secret_value() == "abcd-efgh-jkmn"
    assert request.new_password.get_secret_value() == "a-new-password"


def test_only_the_player_change_new_password_takes_the_sign_up_floor() -> None:
    """The same deliberate asymmetry as the coach's change, and the only test that
    would catch the two annotations being swapped."""
    change = PlayerChangePasswordRequest.model_validate(PLAYER_CHANGE | {"password": "x"})
    assert change.password is not None
    with pytest.raises(ValidationError):
        PlayerChangePasswordRequest.model_validate(PLAYER_CHANGE | {"new_password": "x" * 7})
