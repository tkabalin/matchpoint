from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, SecretStr, StringConstraints

from matchpoint_api.auth import OTP_LENGTH
from matchpoint_api.schemas.coach import (
    EMAIL_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
)

# Comments rather than docstrings, as in schemas/coach.py: a schema docstring becomes
# its description in the OpenAPI spec and the generated client.

# The same shape as CoachCreate.email — stripped, bounded, validated — on every body
# here: an address that could sign up must be able to request a code, answer it and
# log in, byte for byte.
_Email = Annotated[EmailStr, StringConstraints(strip_whitespace=True, max_length=EMAIL_MAX_LENGTH)]

# One annotation for both bodies that answer a code, so their generated-client contracts
# cannot drift apart. SecretStr as a password is: the code is a live credential, and
# listing it in errors.py's SECRET_FIELDS is what keeps it out of a 422's echoed input.
# The exact-length bounds reach the spec, so the forms know the shape without a
# hand-written twin. Digits-only is deliberately not enforced: a six-character non-code
# is simply a wrong code (400), not a malformed request.
_Otp = Annotated[SecretStr, Field(min_length=OTP_LENGTH, max_length=OTP_LENGTH)]


class LoginRequest(BaseModel):
    email: _Email
    # Only the ceiling, deliberately: PASSWORD_MIN_LENGTH is sign-up policy for *new*
    # passwords, and enforcing it here would lock out every coach who enrolled before
    # a later raise of the floor. Whether the password is right is the stored hash's
    # question; the ceiling just bounds the request body, exactly as at sign-up.
    password: Annotated[SecretStr, Field(max_length=PASSWORD_MAX_LENGTH)]


class OtpRequest(BaseModel):
    email: _Email


class VerifyOtpRequest(BaseModel):
    email: _Email
    otp: _Otp


class ForgotPasswordRequest(BaseModel):
    email: _Email


class ResetPasswordRequest(BaseModel):
    email: _Email
    otp: _Otp
    # Both of CoachCreate's bounds, floor included: this is a *new* password, so
    # sign-up policy applies — unlike login's, which only bounds the body.
    new_password: Annotated[
        SecretStr, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    ]
