import uuid
from datetime import date, datetime, timedelta

from pydantic import BaseModel, ConfigDict, field_validator

from matchpoint_api.models import SetsFormat, Surface
from matchpoint_api.schemas.types import ShortText

# Room to back-fill a season or two of matches, while still bracketing a wrong
# century or a transposed year digit.
MAX_PAST_YEARS = 10


class MatchCreate(BaseModel):
    player_id: uuid.UUID
    opponent_name: ShortText | None = None
    played_on: date
    surface: Surface | None = None
    event: ShortText | None = None
    sets_format: SetsFormat | None = None

    @field_validator("played_on")
    @classmethod
    def _reject_implausible_played_on(cls, value: date) -> date:
        """Bound the match date at both ends as a guard against typos.

        The future is closed entirely: capture starts courtside, so a match is
        recorded while or after it is played, never before — a date ahead of today is
        a typo, not a fixture being scheduled. Today itself stays valid.

        Neither bound is real validation, and the floor is deliberately loose: it
        catches a wrong century or a transposed year digit, not last Tuesday typed
        for this one. Both are server-side only, as on PlayerCreate.date_of_birth —
        JSON Schema can express neither, so the match setup form needs its own check.
        """
        today = date.today()
        if value > today:
            raise ValueError("match date cannot be in the future")
        # Approximate rather than calendar-exact, for the reason given on
        # PlayerCreate.date_of_birth: leap-day precision buys a typo guard nothing.
        if value < today - timedelta(days=365.25 * MAX_PAST_YEARS):
            raise ValueError(f"match date cannot be more than {MAX_PAST_YEARS} years ago")
        return value


class MatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    opponent_name: str | None
    played_on: date
    surface: Surface | None
    event: str | None
    sets_format: SetsFormat | None
    created_at: datetime
    updated_at: datetime
