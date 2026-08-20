from typing import Annotated

from pydantic import EmailStr, Field, SecretStr, StringConstraints

from matchpoint_api.auth import OTP_LENGTH
from matchpoint_api.schemas.coach import EMAIL_MAX_LENGTH, NewPassword, Password
from matchpoint_api.schemas.types import RequestModel

# Comments rather than docstrings, as in schemas/coach.py: a schema docstring becomes
# its description in the OpenAPI spec and the generated client.

# The same shape as CoachCreate.email — stripped, bounded, validated — on every body
# here: an address that could sign up must be able to request a code, answer it and
# log in, byte for byte.
_Email = Annotated[EmailStr, StringConstraints(strip_whitespace=True, max_length=EMAIL_MAX_LENGTH)]

# The username the server minted for a player (usernames.py, String(20) on the row):
# stripped like the email, ceiling only. No floor and no format rule, for the reason
# login's password has no floor: the credential to accept is whatever create once
# handed out, and a malformed username is simply a wrong one (401), not a bad request.
USERNAME_MAX_LENGTH = 20
_Username = Annotated[str, StringConstraints(strip_whitespace=True, max_length=USERNAME_MAX_LENGTH)]

# One annotation for both bodies that answer a code, so their generated-client contracts
# cannot drift apart. SecretStr as a password is: the code is a live credential, and
# listing it in errors.py's SECRET_FIELDS is what keeps it out of a 422's echoed input.
# The exact-length bounds reach the spec, so the forms know the shape without a
# hand-written twin. Digits-only is deliberately not enforced: a six-character non-code
# is simply a wrong code (400), not a malformed request.
_Otp = Annotated[SecretStr, Field(min_length=OTP_LENGTH, max_length=OTP_LENGTH)]


class LoginRequest(RequestModel):
    email: _Email
    password: Password


class PlayerLoginRequest(RequestModel):
    username: _Username
    password: Password


class OtpRequest(RequestModel):
    email: _Email


class VerifyOtpRequest(RequestModel):
    email: _Email
    otp: _Otp


class ForgotPasswordRequest(RequestModel):
    email: _Email


class VerifyResetCodeRequest(RequestModel):
    email: _Email
    otp: _Otp


class ResetPasswordRequest(RequestModel):
    # No otp: verify-reset-code has already answered the code, and the cookie it minted
    # is what this request presents instead. The email stays because that cookie is
    # checked against it, exactly as the verification cookie is at sign-up.
    email: _Email
    new_password: NewPassword


class ChangePasswordRequest(RequestModel):
    # No email: the session says whose password this is. The current one is named
    # `password` as login names it, for the same meaning and the same annotation, and is
    # already kept out of a 422 body by errors.py under that name.
    password: Password
    new_password: NewPassword
