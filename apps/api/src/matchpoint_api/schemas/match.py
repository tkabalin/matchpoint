import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict

from matchpoint_api.models import (
    MatchResult,
    MatchResultReason,
    MatchSide,
    ScoringSystem,
    Surface,
)
from matchpoint_api.schemas.types import UNSET, RequestModel, ShortText, UpdateModel

# Room to back-fill a season or two of matches, while still bracketing a wrong
# century or a transposed year digit.
MAX_PAST_YEARS = 10


def _reject_implausible_played_on(value: date) -> date:
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


# The bounds in one place, for create and update alike, as DateOfBirth is on the player.
PlayedOn = Annotated[date, AfterValidator(_reject_implausible_played_on)]


def _reject_non_v4_id(value: uuid.UUID) -> uuid.UUID:
    """Only accept the one shape the client mints.

    Match ids come from crypto.randomUUID, which produces version 4 and nothing
    else, so any other version (the nil UUID included) is a caller bug rather
    than a match coming in to sync. Server-side only, as PlayedOn's bounds are:
    the spec keeps `format: uuid`, so the generated client does not change.
    """
    if value.version != 4:
        raise ValueError("match id must be a version-4 UUID")
    return value


ClientMatchId = Annotated[uuid.UUID, AfterValidator(_reject_non_v4_id)]


class MatchCreate(RequestModel):
    # Client-assigned: a match is created offline and syncs later, so it needs an
    # identity before any server sees it, and a retried sync needs that id to name the
    # row an interrupted attempt may already have written. Server-minted when absent.
    id: ClientMatchId | None = None
    player_id: uuid.UUID
    opponent_name: ShortText | None = None
    played_on: PlayedOn
    surface: Surface | None = None
    event: ShortText | None = None
    scoring_system: ScoringSystem | None = None
    # Settable at creation because back-filled matches arrive with the result known.
    result: MatchResult | None = None
    # How the match ended, which a back-filled one may know as well as its result.
    result_reason: MatchResultReason | None = None


# player_id is absent on purpose: a match reaches its owner through its player, so a
# writable one would let a match walk across that boundary. played_on defaults to UNSET,
# its column being NOT NULL.
class MatchUpdate(UpdateModel):
    opponent_name: ShortText | None = None
    played_on: PlayedOn = UNSET
    surface: Surface | None = None
    event: ShortText | None = None
    scoring_system: ScoringSystem | None = None
    result: MatchResult | None = None
    # Not frozen by completion the way result and scoring_system are: it describes the
    # ending rather than signalling it, so a mis-tapped reason corrects like a typo'd
    # opponent name.
    result_reason: MatchResultReason | None = None


class MatchCaptureClaim(RequestModel):
    """The device asking to capture a match, named by an id it mints and keeps."""

    device_id: uuid.UUID


# Answered by the capture routes and deliberately absent from MatchRead: a claim read
# off a list is already out of date, and the only answer a client can act on is the one
# its own claim request gives it.
class MatchCaptureRead(BaseModel):
    """A live capture claim: who holds the match, and when the claim lapses."""

    device_id: uuid.UUID
    expires_at: datetime


# Derived by the server from the match's events rather than sent by anyone, so there is
# no MatchSetCreate to pair this with.
class MatchSetRead(BaseModel):
    """One set's game score, as the server derives it from the match's checkpoints and points."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    match_id: uuid.UUID
    set_number: int
    games_won_tracked: int
    games_won_opponent: int
    # Null while the set is in flight, nothing having closed it yet.
    winner: MatchSide | None
    created_at: datetime
    updated_at: datetime


# The player's name is carried here and nowhere else on a match, so the resume banner
# renders from one request rather than following each match to its player. The claim's
# device and deadline stay off it for the reason MatchCaptureRead gives above.
class MatchInProgressRead(BaseModel):
    """A match with capture under way, as the resume banner shows it."""

    id: uuid.UUID
    player_id: uuid.UUID
    player_first_name: str
    player_last_name: str
    opponent_name: str | None


class MatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    opponent_name: str | None
    played_on: date
    surface: Surface | None
    event: str | None
    scoring_system: ScoringSystem | None
    result: MatchResult | None
    result_reason: MatchResultReason | None
    created_at: datetime
    updated_at: datetime
