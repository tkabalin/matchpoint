import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict

from matchpoint_api.models import NoteFocus
from matchpoint_api.schemas.types import UNSET, LongText, RequestModel, UpdateModel

# Room to write up a season or two of past sessions, while still bracketing a wrong
# century or a transposed year digit. The same figure `MatchCreate.played_on` uses,
# because notes and matches cover the same seasons.
MAX_PAST_YEARS = 10


def _reject_implausible_recorded_on(value: date) -> date:
    """Bound the note's date at both ends as a guard against typos.

    The future is closed entirely: a note records a session that has already
    happened. The floor is deliberately loose, catching a wrong century rather
    than last Tuesday typed for this one.

    Server-side only, as the same bounds on `played_on` and `date_of_birth` are:
    JSON Schema can express neither, so the note form needs its own check.
    """
    today = date.today()
    if value > today:
        raise ValueError("note date cannot be in the future")
    # Approximate rather than calendar-exact, for the reason given on the two sibling
    # bounds: leap-day precision buys a typo guard nothing.
    if value < today - timedelta(days=365.25 * MAX_PAST_YEARS):
        raise ValueError(f"note date cannot be more than {MAX_PAST_YEARS} years ago")
    return value


def _canonical_focus_areas(value: list[NoteFocus]) -> list[NoteFocus]:
    """Declaration order, each area at most once.

    Filing a note under the same area twice says nothing the once did, and a
    canonical order means two notes filed the same way compare equal.
    """
    return [focus for focus in NoteFocus if focus in value]


# The bounds and the ordering in one place, for create and update alike, as DateOfBirth
# and PlayedOn are on their own schemas.
RecordedOn = Annotated[date, AfterValidator(_reject_implausible_recorded_on)]
FocusAreas = Annotated[list[NoteFocus], AfterValidator(_canonical_focus_areas)]


class PlayerNoteCreate(RequestModel):
    """A coach's note about one player. The player is the path, never the body."""

    body: LongText
    # Sent rather than stamped from the server's own date: the client knows the coach's
    # calendar day, where a server in UTC would date an after-midnight South African note
    # to the day before. The bound above reads the server's day, so that hour is refused.
    recorded_on: RecordedOn
    focus_areas: FocusAreas = []


class PlayerNoteUpdate(UpdateModel):
    """Every field a note may change after it is written, each optional.

    player_id is absent for MatchUpdate's reason: a note reaches its owner through its
    player, so a writable one would let a note walk across that ownership boundary.
    """

    body: LongText = UNSET
    recorded_on: RecordedOn = UNSET
    # Over a NOT NULL column, so null is a 422 and an empty list is how a coach clears
    # the areas a note is filed under.
    focus_areas: FocusAreas = UNSET


class PlayerNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # Readable but absent from Create: the player comes from the path, so there is
    # nothing for a client to send, and nothing a splat could set from a body.
    player_id: uuid.UUID
    body: str
    recorded_on: date
    focus_areas: list[NoteFocus]
    created_at: datetime
    updated_at: datetime
