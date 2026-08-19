import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr

from matchpoint_api.models import DominantHand, Gender
from matchpoint_api.schemas.types import UNSET, LongText, RequestModel, ShortText, UpdateModel

# Past any real player by decades, and a shade inside the oldest verified human
# lifespan (122) — a gap this guard has no use for, since it exists to reject a
# wrong century, not to adjudicate longevity records.
MAX_AGE_YEARS = 120

# Comfortably past the 43 characters `new_session_token` produces. The bound is here to
# keep an unbounded string away from the hash, not to describe the code, so it does not
# pin the generator's output length.
TRANSFER_CODE_MAX_LENGTH = 100


def _reject_implausible_date_of_birth(value: date) -> date:
    """Bound the date of birth at both ends as a guard against typos.

    The upper bound is deliberately not pydantic's PastDate, which also
    rejects today: today is not the future, and a validator that quietly
    rejects a value the rule permits is the kind of surprise that costs an
    afternoon to track down.

    Neither bound is real validation — they catch a wrong century or a
    transposed digit, not 1955 typed for 1995. That is the whole ambition.

    Server-side only: JSON Schema can express neither, so the OpenAPI spec
    carries just `format: date` and the generated TypeScript client will send
    an out-of-range date and take the 422. The player form needs its own check.
    """
    today = date.today()
    if value > today:
        raise ValueError("date of birth cannot be in the future")
    # Approximate rather than calendar-exact: an exact boundary would need
    # leap-day handling to buy precision a typo guard has no use for.
    if value < today - timedelta(days=365.25 * MAX_AGE_YEARS):
        raise ValueError(f"date of birth cannot be more than {MAX_AGE_YEARS} years ago")
    return value


# The bounds in one place, for create and update alike. Pairing the alias with `| None`
# leaves the validator seeing only a date: each union member is validated on its own.
DateOfBirth = Annotated[date, AfterValidator(_reject_implausible_date_of_birth)]


class PlayerCreate(RequestModel):
    first_name: ShortText
    last_name: ShortText
    date_of_birth: DateOfBirth | None = None
    dominant_hand: DominantHand | None = None
    gender: Gender | None = None
    notes: LongText | None = None


# Every field optional, so a PATCH carries only what changed. The name parts default to
# UNSET rather than None because their columns are NOT NULL: an explicit null is then a
# 422 from pydantic instead of an IntegrityError from the flush.
class PlayerUpdate(UpdateModel):
    first_name: ShortText = UNSET
    last_name: ShortText = UNSET
    date_of_birth: DateOfBirth | None = None
    dominant_hand: DominantHand | None = None
    gender: Gender | None = None
    notes: LongText | None = None


class PlayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    first_name: str
    last_name: str
    date_of_birth: date | None
    dominant_hand: DominantHand | None
    gender: Gender | None
    notes: str | None
    # Readable but absent from PlayerCreate: ownership comes from the authenticated
    # coach, never from the request body, so there is nothing for a client to send.
    coach_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class RedeemTransferCodeRequest(RequestModel):
    # SecretStr for the reason the OTP is one: the code is a live credential, and naming
    # it in errors.py's SECRET_FIELDS is what keeps it out of a 422's echoed input.
    code: Annotated[SecretStr, Field(max_length=TRANSFER_CODE_MAX_LENGTH)]


class PlayerTransferCodeRead(BaseModel):
    """A code handing one player, with their match history, to another coach."""

    # Plain str, not SecretStr: this is the one response that must carry the code
    # itself, and SecretStr would serialise it as asterisks.
    code: str
