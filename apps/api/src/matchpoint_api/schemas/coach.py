import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, StringConstraints

from matchpoint_api.schemas.types import UNSET, RequestModel, ShortText, UpdateModel

# The longest address SMTP will carry (RFC 5321), and the width of the column.
EMAIL_MAX_LENGTH = 254

# Bounds, not a password policy. The floor is the shortest length worth accepting. The
# ceiling bounds the request body and nothing else: Argon2's cost comes from its memory
# and time parameters rather than its input, so a megabyte hashes in the time fifteen
# characters do, and the length of a password is not a denial-of-service surface. No
# composition rules — NIST SP 800-63B advises against them — and no breach-list check,
# which would need a service we do not run.
#
# Both bounds apply to the submitted form, before security.py normalises it, which can
# change the length in either direction. Harmless at the ceiling, since hashing does not
# care; at the floor it means eight composable characters can normalise to fewer.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


# Comments rather than docstrings throughout: a schema's docstring becomes its description
# in the OpenAPI spec and a TSDoc comment on the generated client type, and none of the
# notes here is anything an API consumer needs.
#
# CoachCreate takes a password and never a hash. Turning one into the other is the route's
# job, so there is no field a client could use to supply a hash of its own choosing.
class CoachCreate(RequestModel):
    # EmailStr costs no new dependency — email-validator arrives with FastAPI's standard
    # extra — and does no DNS lookup, since deliverability checking is off. It folds the
    # *domain* only: Mike@Example.COM arrives here as Mike@example.com, and the local part
    # is lowercased by the model's `validates` on the way to the column.
    #
    # Stripped because a pasted address routinely carries a trailing space, and the model
    # deliberately leaves whitespace and validity to be handled here, where a rejection
    # can be shown to the coach.
    email: Annotated[
        EmailStr, StringConstraints(strip_whitespace=True, max_length=EMAIL_MAX_LENGTH)
    ]
    display_name: ShortText
    # SecretStr keeps the password out of reprs, tracebacks and any structured log of the
    # model, and unlike the date-of-birth bounds its own bounds do reach the OpenAPI spec
    # (format: password, writeOnly, minLength, maxLength) — so the sign-up form enforces
    # them without a hand-written twin. What it cannot do is keep the password out of a
    # 422 body, since FastAPI echoes the submitted value back in detail[].input and
    # SecretStr never sees that error — so `errors.py` redacts it there instead.
    #
    # Not stripped, unlike ShortText above: a space is a legitimate password character, so
    # stripping would silently alter the credential a coach chose.
    password: Annotated[
        SecretStr, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
    ]


# The display name is the only field here, so it is the only one the route can reach.
# The email stays out deliberately: it is the sign-in identity, and moving it needs the
# OTP machinery sign-up goes through rather than a field on a PATCH body.
class CoachUpdate(UpdateModel):
    # Absent leaves the name alone, and an explicit null is a 422: the column is NOT
    # NULL, so the annotation stays non-optional. See UNSET in types.py.
    display_name: ShortText = UNSET


# password_hash is absent, and belongs nowhere else either. `response_model` filters a
# response down to the fields declared here, so this omission is what keeps the hash from
# following a Coach row out of any route that returns one.
class CoachRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime
    updated_at: datetime
