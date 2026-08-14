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

# The two password bounds, one annotation each so bodies meaning the same thing cannot
# drift apart in the generated client (_Otp's reason). _Password is a credential being
# checked against a stored hash, so it takes only the ceiling: the floor is sign-up
# policy for *new* passwords, and applying it here would lock out every coach who
# enrolled before a later raise of it. _NewPassword is a password being chosen, so it
# takes both of CoachCreate's bounds.
_Password = Annotated[SecretStr, Field(max_length=PASSWORD_MAX_LENGTH)]
_NewPassword = Annotated[
    SecretStr, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
]


class LoginRequest(BaseModel):
    email: _Email
    password: _Password


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
    new_password: _NewPassword


class ChangePasswordRequest(BaseModel):
    # No email: the session says whose password this is. The current one is named
    # `password` as login names it, for the same meaning and the same annotation, and is
    # already kept out of a 422 body by errors.py under that name.
    password: _Password
    new_password: _NewPassword
