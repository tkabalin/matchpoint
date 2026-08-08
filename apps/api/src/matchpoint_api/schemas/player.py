import uuid
from datetime import date, datetime, timedelta

from pydantic import BaseModel, ConfigDict, field_validator

from matchpoint_api.models import DominantHand, Gender
from matchpoint_api.schemas.types import LongText, ShortText

# Past any real player by decades, and a shade inside the oldest verified human
# lifespan (122) — a gap this guard has no use for, since it exists to reject a
# wrong century, not to adjudicate longevity records.
MAX_AGE_YEARS = 120


class PlayerCreate(BaseModel):
    first_name: ShortText
    last_name: ShortText
    date_of_birth: date | None = None
    dominant_hand: DominantHand | None = None
    gender: Gender | None = None
    notes: LongText | None = None

    @field_validator("date_of_birth")
    @classmethod
    def _reject_implausible_date_of_birth(cls, value: date | None) -> date | None:
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
        if value is None:
            return value
        today = date.today()
        if value > today:
            raise ValueError("date of birth cannot be in the future")
        # Approximate rather than calendar-exact: an exact boundary would need
        # leap-day handling to buy precision a typo guard has no use for.
        if value < today - timedelta(days=365.25 * MAX_AGE_YEARS):
            raise ValueError(f"date of birth cannot be more than {MAX_AGE_YEARS} years ago")
        return value


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
    coach_id: uuid.UUID | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
