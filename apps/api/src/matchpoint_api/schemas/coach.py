import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, StringConstraints

from matchpoint_api.models import ScoringSystem, Surface
from matchpoint_api.schemas.types import UNSET, RequestModel, ShortText, UpdateModel

# The longest address SMTP will carry (RFC 5321), and the width of the column.
EMAIL_MAX_LENGTH = 254

# Bounds, not a password policy. The floor is the shortest length worth accepting. The
# ceiling bounds the request body and nothing else: Argon2's cost comes from its memory
# and time parameters rather than its input, so a megabyte hashes in the time fifteen
# characters do, and the length of a password is not a denial-of-service surface. No
# composition rules, which NIST SP 800-63B advises against. What that standard does ask
# for, refusing the repeated, sequential, common and self-naming choices these bounds
# accept, is `password_policy.py`, which the routes call: it needs the coach's own email
# and name, and JSON Schema could not carry the rules anyway.
#
# Both bounds apply to the submitted form, before security.py normalises it, which can
# change the length in either direction. Harmless at the ceiling, since hashing does not
# care; at the floor it means eight composable characters can normalise to fewer.
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128

# The two password shapes, one annotation each so bodies meaning the same thing cannot
# drift apart in the generated client. `Password` is a credential being checked against a
# stored hash, so it takes only the ceiling: the floor is sign-up policy for *new*
# passwords, and applying it here would lock out every coach who enrolled before a later
# raise of it. `NewPassword` is a password being chosen, so it takes both bounds.
#
# SecretStr keeps the value out of reprs, tracebacks and any structured log of the model,
# and unlike the date-of-birth bounds its own bounds do reach the OpenAPI spec (format:
# password, writeOnly, minLength, maxLength), so a form enforces them without a
# hand-written twin. What it cannot do is keep the value out of a 422 body, since FastAPI
# echoes the submitted input back in detail[] and SecretStr never sees that error; the
# field names are in `errors.py`'s SECRET_FIELDS, which redacts it there instead.
#
# Neither is stripped, unlike ShortText: a space is a legitimate password character, so
# stripping would silently alter the credential a coach chose.
Password = Annotated[SecretStr, Field(max_length=PASSWORD_MAX_LENGTH)]
NewPassword = Annotated[
    SecretStr, Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)
]


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
    # A password being chosen, so both bounds apply: see NewPassword above.
    password: NewPassword


# The email stays out deliberately: it is the sign-in identity, and moving it needs the
# OTP machinery sign-up goes through rather than a field on a PATCH body.
class CoachUpdate(UpdateModel):
    # Absent leaves the name alone, and an explicit null is a 422: the column is NOT
    # NULL, so the annotation stays non-optional. See UNSET in types.py.
    display_name: ShortText = UNSET
    # Nullable columns, so unlike display_name an explicit null is valid and clears the
    # preference; absent still leaves it alone.
    default_surface: Surface | None = None
    default_scoring_system: ScoringSystem | None = None


# A body on a DELETE, which is unusual but is where the credential has to go: a password
# in a query string lands in access logs and browser history. No email, the session saying
# whose account this is, and no confirmation field, since a typed "DELETE" proves only
# that the form was filled in, where the password proves who filled it in.
class CoachDelete(RequestModel):
    # Named `password` as LoginRequest names it, for the same meaning and the same
    # annotation, and so already redacted from a 422 body under that name.
    password: Password
    # Waives the refusal a non-empty roster earns, so the coach who wants out reaches it
    # in one request rather than deleting each player first. False by default, so no
    # roster is ever cleared by a request that did not ask for it.
    delete_players: bool = False


# The step before that one in the same flow (#207), which is why it carries the password
# and nothing else: it answers whether the password is right and does nothing with it, so
# `delete_players` has no meaning here. CoachDelete is left standing on its own rather than
# subclassed off this, since a body that grew a field would grow it for both.
class CoachVerifyPassword(RequestModel):
    # Named and annotated as CoachDelete names it, so one flow's two steps send the same
    # field, already redacted from a 422 body under that name.
    password: Password


# password_hash is absent, and belongs nowhere else either. `response_model` filters a
# response down to the fields declared here, so this omission is what keeps the hash from
# following a Coach row out of any route that returns one.
class CoachRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    default_surface: Surface | None
    default_scoring_system: ScoringSystem | None
    # Read-only, and absent from every Create and Update schema: a photo is set
    # by POST .../photo and cleared by DELETE .../photo, never by a PATCH body —
    # a client cannot name a URL it does not own.
    photo_url: str | None
    created_at: datetime
    updated_at: datetime
