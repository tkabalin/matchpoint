import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from matchpoint_api.models import MatchSide
from matchpoint_api.schemas.point import MAX_BATCH_POINTS, MAX_COUNTER
from matchpoint_api.schemas.types import RequestModel

# A board holds at most the sets a match can play, and the formats the client scores play
# at most five: a ceiling on the set rows one document can put into `match_sets`, not a
# rule check.
MAX_SNAPSHOT_SETS = 5
# The fold adds the tail's games to a declared count before the sum reaches the integer
# column, so unlike the point counters this cannot borrow the column's own ceiling.
MAX_GAMES = 999


class ScoreSnapshotSet(RequestModel):
    """One set of the declared scoreboard: games each, the breaker if one was played,
    and who took the set, stamped by the client for the same reason `is_set_end` is:
    the server never replays the rules to work it out."""

    set_number: int = Field(ge=1, le=MAX_COUNTER)
    games_tracked: int = Field(ge=0, le=MAX_GAMES)
    games_opponent: int = Field(ge=0, le=MAX_GAMES)
    tiebreak_tracked: int | None = Field(default=None, ge=0, le=MAX_COUNTER)
    tiebreak_opponent: int | None = Field(default=None, ge=0, le=MAX_COUNTER)
    winner: MatchSide | None = None

    @model_validator(mode="after")
    def _check_tiebreak_paired(self) -> Self:
        if (self.tiebreak_tracked is None) != (self.tiebreak_opponent is None):
            raise ValueError("a tiebreak score names both sides or neither")
        return self


class ScoreSnapshot(RequestModel):
    """The whole scoreboard, set 1 first with no gaps: the last entry is the set in
    progress, or the set that decided the match."""

    sets: list[ScoreSnapshotSet] = Field(min_length=1, max_length=MAX_SNAPSHOT_SETS)

    @model_validator(mode="after")
    def _check_sets_are_contiguous(self) -> Self:
        # Positional on the client, numbered on the wire so the derivation can merge by
        # set_number: the numbering has to say the same thing as the order.
        if [entry.set_number for entry in self.sets] != list(range(1, len(self.sets) + 1)):
            raise ValueError("sets are numbered from 1 in order with no gaps")
        return self


class ScoreCheckpointCreate(RequestModel):
    """One checkpoint as the capture client's score editor recorded it.

    Shape only, as with a point: the client is the rulebook, so nothing here asks
    whether 6-5 can close a set under the match's scoring system.
    """

    id: uuid.UUID
    sequence: int = Field(ge=0, le=MAX_COUNTER)
    serves_next: MatchSide
    order_changed: bool
    after: ScoreSnapshot


class ScoreCheckpointBatch(RequestModel):
    """One flush of a device's queued checkpoints, for one match, all-or-nothing like
    a point batch and idempotent on each checkpoint's id."""

    device_id: uuid.UUID
    checkpoints: list[ScoreCheckpointCreate] = Field(min_length=1, max_length=MAX_BATCH_POINTS)

    @model_validator(mode="after")
    def _check_for_repeats(self) -> Self:
        ids = {checkpoint.id for checkpoint in self.checkpoints}
        if len(ids) != len(self.checkpoints):
            raise ValueError("a batch cannot carry the same checkpoint id twice")
        sequences = {checkpoint.sequence for checkpoint in self.checkpoints}
        if len(sequences) != len(self.checkpoints):
            raise ValueError("a batch cannot carry the same sequence twice")
        return self


class ScoreCheckpointRead(BaseModel):
    """One stored checkpoint, read back beside the match's points. No timestamps, for
    PointRead's reason: the row is never corrected, only deleted."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    match_id: uuid.UUID
    sequence: int
    serves_next: MatchSide
    order_changed: bool
    after: ScoreSnapshot
