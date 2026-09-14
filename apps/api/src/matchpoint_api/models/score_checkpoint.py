import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.match_set import MatchSide
from matchpoint_api.models.types import str_enum


class ScoreCheckpoint(Base):
    """The scoreboard as the coach declared it at one moment of the match (#268).

    Capture's score editor is how a coach corrects a mis-tap or catches up on games
    nobody watched: rather than fabricating points, the client records what the
    board says now. A checkpoint shares the match's sequence space with its points,
    and the set derivation folds the latest one in as the base the later points add
    to. Structural validation only, as with points: the client is the rulebook.
    """

    __tablename__ = "score_checkpoints"
    __table_args__ = (
        # Deduplicated on this pair as points are, and its index serves per-match
        # reads, which is why match_id carries no index of its own.
        UniqueConstraint("match_id", "sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    sequence: Mapped[int]
    # Who serves the next game, which is how the client cross-checks the declared
    # games against its rotation, or re-anchors it when `order_changed` says the real
    # order deviated (ITF rule 27).
    serves_next: Mapped[MatchSide] = mapped_column(
        str_enum(MatchSide, "score_checkpoint_serves_next")
    )
    order_changed: Mapped[bool]
    # The declared scoreboard, one entry per set, in the shape `ScoreSnapshot` in
    # `schemas/score_checkpoint.py` vets on the way in. The schema's one JSONB column:
    # a bounded document (at most a match's sets) only ever read whole, never queried.
    after: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
