from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, SecretStr, StringConstraints

from matchpoint_api.schemas.coach import EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH

# Comments rather than docstrings, as in schemas/coach.py: a schema docstring becomes
# its description in the OpenAPI spec and the generated client.


class LoginRequest(BaseModel):
    # The same shape as CoachCreate.email — stripped, bounded, validated — so an
    # address that could sign up can log in, byte for byte.
    email: Annotated[
        EmailStr, StringConstraints(strip_whitespace=True, max_length=EMAIL_MAX_LENGTH)
    ]
    # Only the ceiling, deliberately: PASSWORD_MIN_LENGTH is sign-up policy for *new*
    # passwords, and enforcing it here would lock out every coach who enrolled before
    # a later raise of the floor. Whether the password is right is the stored hash's
    # question; the ceiling just bounds the request body, exactly as at sign-up.
    password: Annotated[SecretStr, Field(max_length=PASSWORD_MAX_LENGTH)]
