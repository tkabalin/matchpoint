import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from matchpoint_api.models import (
    CourtDepth,
    CourtSide,
    EndReason,
    FailureMode,
    MatchSide,
    RallyBucket,
    ReturnOutcome,
    ServeOutcome,
    ShotType,
    UnusualReason,
    Wing,
)
from matchpoint_api.schemas.types import LongText, RequestModel

# The most points one flush may carry, set against the 1 MB body limit
# (`body_limit.py`): every field filled and no note, a point is ~660 bytes of JSON, so
# 500 of them is ~330 KB and the rest of the megabyte is room for notes. Only a batch
# whose points nearly all carry prose can still trip the 413, and the answer to that
# is to split it rather than to raise either bound.
MAX_BATCH_POINTS = 500

# What an `integer` column holds. The three counters below are bounded by it because a
# value past it reaches Postgres as a DataError, not the IntegrityError the route
# catches, so it would answer 500 and the sync layer would retry the batch for ever.
MAX_COUNTER = 2_147_483_647

# The point had no shot of its own to describe: nobody reached the ball, or nobody
# was allowed to.
_NO_CONTACT_END_REASONS = frozenset({EndReason.ACE, EndReason.DOUBLE_FAULT, EndReason.UNUSUAL})


def _check_serve_location(
    attempt: int,
    outcome: ServeOutcome | None,
    box: CourtSide | None,
    fault_mode: FailureMode | None,
    *,
    server: MatchSide,
) -> None:
    """Where one serve attempt landed: a box, a fault mode, or nothing at all."""
    if outcome is None or server is MatchSide.OPPONENT:
        # Either there was no such attempt, or it was the opponent's, whose placement
        # is out of scope for capture.
        if box is not None or fault_mode is not None:
            raise ValueError(f"serve {attempt} records no location on this point")
    elif outcome is ServeOutcome.FAULT:
        if fault_mode is None or box is not None:
            raise ValueError(f"a faulted serve {attempt} records serve{attempt}_fault_mode alone")
    elif box is None or fault_mode is not None:
        raise ValueError(f"a landed serve {attempt} records serve{attempt}_box")


class PointCreate(RequestModel):
    """One captured point, exactly as the capture client's scoring engine stamped it.

    Validated for shape alone, never for tennis-logic coherence: the client that
    scored the match is the only rulebook, so a stamp the server disagrees with is
    still stored as sent.
    """

    # Client-minted, and the only primary key a request body carries: a point exists
    # on the device before any server sees it, and a retried flush needs that id to
    # name the row an interrupted attempt may already have written.
    id: uuid.UUID
    # Position in the match, assigned by the client. Arrival order says nothing: a
    # batch can be retried, or flushed hours after the points in it were captured.
    sequence: int = Field(ge=0, le=MAX_COUNTER)
    server: MatchSide
    # The tracked player's side, always, whoever served.
    won: bool

    # Null is a serve nobody watched, not a fourth outcome: the capture model drops
    # the attempt rather than inventing one (#210). Its location goes with it.
    serve1_outcome: ServeOutcome | None = None
    serve1_box: CourtSide | None = None
    serve1_fault_mode: FailureMode | None = None
    serve2_outcome: ServeOutcome | None = None
    serve2_box: CourtSide | None = None
    serve2_fault_mode: FailureMode | None = None

    return_outcome: ReturnOutcome | None = None

    # Null is an ending nobody watched, and every field describing the ending (the
    # unusual reason, the last shot, the final ball) is null with it.
    end_reason: EndReason | None = None
    unusual_reason: UnusualReason | None = None
    # A coach's annotation, legal on any point rather than only an unusual one (#175).
    note: LongText | None = None

    wing: Wing | None = None
    shot_type: ShotType | None = None
    ball_in: bool | None = None
    ball_half: CourtSide | None = None
    ball_depth: CourtDepth | None = None
    ball_out_mode: FailureMode | None = None

    rally_length_bucket: RallyBucket | None = None

    # The score context, stamped on every point by the client's scoring engine. All
    # required: a missing stamp is a client bug, and defaulting the booleans to false
    # would record it as a fact.
    set_number: int = Field(ge=1, le=MAX_COUNTER)
    game_number: int = Field(ge=1, le=MAX_COUNTER)
    in_tiebreak: bool
    is_break_point: bool
    is_game_point: bool
    is_game_end: bool
    is_set_point: bool
    is_set_end: bool
    is_match_point: bool

    @model_validator(mode="after")
    def _check_serve_attempts(self) -> Self:
        # Only after, not exactly when: a faulted first serve whose second attempt went
        # unwatched is a lone fault, the same observation hole as no serve at all.
        if self.serve2_outcome is not None and self.serve1_outcome is not ServeOutcome.FAULT:
            raise ValueError("a second serve is recorded only after the first serve faulted")
        _check_serve_location(
            1,
            self.serve1_outcome,
            self.serve1_box,
            self.serve1_fault_mode,
            server=self.server,
        )
        _check_serve_location(
            2,
            self.serve2_outcome,
            self.serve2_box,
            self.serve2_fault_mode,
            server=self.server,
        )
        both_faulted = (
            self.serve1_outcome is ServeOutcome.FAULT and self.serve2_outcome is ServeOutcome.FAULT
        )
        if both_faulted != (self.end_reason is EndReason.DOUBLE_FAULT):
            raise ValueError("both serves faulted exactly when end_reason is double_fault")
        return self

    @model_validator(mode="after")
    def _check_ending(self) -> Self:
        if self.server is MatchSide.TRACKED and self.return_outcome is not None:
            raise ValueError("return_outcome belongs to a point the opponent served")
        # A return is a fact about a serve that landed, so it cannot outlive one that
        # was never watched; the per-serve return split groups on that serve too.
        if self.return_outcome is not None and self.serve1_outcome is None:
            raise ValueError("return_outcome requires a watched serve")
        if self.end_reason is not EndReason.UNUSUAL and self.unusual_reason is not None:
            raise ValueError("unusual_reason belongs to a point that ended unusually")
        return self

    @model_validator(mode="after")
    def _check_last_shot(self) -> Self:
        # A missed return is placed by return_outcome, so asking for the shot and the
        # ball again would capture the same fact under a second name.
        missed_return = self.return_outcome not in {None, ReturnOutcome.IN}
        unseen_ending = self.end_reason is None
        if unseen_ending or self.end_reason in _NO_CONTACT_END_REASONS or missed_return:
            if any(
                value is not None
                for value in (
                    self.wing,
                    self.shot_type,
                    self.ball_in,
                    self.ball_half,
                    self.ball_depth,
                    self.ball_out_mode,
                )
            ):
                raise ValueError("this point records no last shot and no final ball")
            return self
        if (self.wing is None) != (self.shot_type is None):
            raise ValueError("wing and shot_type are recorded together, or neither is")
        # A struck point whose final ball went unwatched: the two travel together, so
        # neither is recorded, the same hole the capture model leaves.
        if self.ball_in is None:
            if any(v is not None for v in (self.ball_half, self.ball_depth, self.ball_out_mode)):
                raise ValueError("a final ball nobody watched records no placement")
            return self
        if self.ball_in:
            if self.ball_half is None or self.ball_depth is None or self.ball_out_mode is not None:
                raise ValueError("a final ball that stayed in records ball_half and ball_depth")
        elif (
            self.ball_out_mode is None or self.ball_half is not None or self.ball_depth is not None
        ):
            raise ValueError("a final ball that went out records ball_out_mode alone")
        return self


class PointBatch(RequestModel):
    """One flush of a device's capture outbox, for one match.

    Ingestion is all-or-nothing: the batch lands whole or nothing in it does, so a
    flush is one thing for the sync layer to acknowledge or park. Re-sending a point
    already stored is a no-op rather than an error, which is what makes a retried
    flush safe.
    """

    # The device the points were captured on, matched against the match's capture
    # claim: holding it, this flush renews it.
    device_id: uuid.UUID
    points: list[PointCreate] = Field(min_length=1, max_length=MAX_BATCH_POINTS)

    @model_validator(mode="after")
    def _check_for_repeats(self) -> Self:
        # Deduplication across flushes is the stored id's job. Inside one batch a
        # repeat is a caller bug, and saying so beats leaving the outcome to which
        # conflict Postgres notices first.
        ids = {point.id for point in self.points}
        if len(ids) != len(self.points):
            raise ValueError("a batch cannot carry the same point id twice")
        sequences = {point.sequence for point in self.points}
        if len(sequences) != len(self.points):
            raise ValueError("a batch cannot carry the same sequence twice")
        return self


class PointRead(BaseModel):
    """One stored point, as the analytics dashboard and the capture client's sync
    reconciliation read it back.

    Carries match_id, for symmetry with MatchSetRead's own match-scoped rows, but not
    created_at or updated_at: a point is never rewritten after it lands, only deleted,
    so those would only restate when the row was ingested, which is bookkeeping neither
    reader needs.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    match_id: uuid.UUID
    sequence: int
    server: MatchSide
    won: bool

    serve1_outcome: ServeOutcome | None
    serve1_box: CourtSide | None
    serve1_fault_mode: FailureMode | None
    serve2_outcome: ServeOutcome | None
    serve2_box: CourtSide | None
    serve2_fault_mode: FailureMode | None

    return_outcome: ReturnOutcome | None

    end_reason: EndReason | None
    unusual_reason: UnusualReason | None
    note: str | None

    wing: Wing | None
    shot_type: ShotType | None
    ball_in: bool | None
    ball_half: CourtSide | None
    ball_depth: CourtDepth | None
    ball_out_mode: FailureMode | None

    rally_length_bucket: RallyBucket | None

    set_number: int
    game_number: int
    in_tiebreak: bool
    is_break_point: bool
    is_game_point: bool
    is_game_end: bool
    is_set_point: bool
    is_set_end: bool
    is_match_point: bool
