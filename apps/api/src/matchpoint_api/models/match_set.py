import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.types import str_enum


# A side of the match, not a player: the opponent is free text on `matches` rather than a
# roster row, so there is no id to point at. MatchResult already frames a match from the
# tracked player's side, and the point model (#120) reads its own sides off this enum.
# Docstring kept to one line, as `match.py`'s enums are: a schema naming this one ships it
# to the generated TypeScript client.
class MatchSide(enum.StrEnum):
    """One side of a match, the coach's tracked player or their opponent."""

    TRACKED = "tracked"
    OPPONENT = "opponent"


class MatchSet(Base):
    """One set's game score, derived by the server from the points it holds (#174).

    The capture client stamps a set and game number on every point, so a set score is a
    group-by over them rather than a replay of the rules, and these rows are recomputed
    at each ingest (#107). Recomputing from whatever points have arrived is what makes a
    late, partial or duplicated batch land on the same answer.
    """

    __tablename__ = "match_sets"
    __table_args__ = (
        # Recomputation upserts on this pair, and the constraint's index leads on
        # match_id, so the foreign key carries no second index of its own.
        UniqueConstraint("match_id", "set_number"),
    )

    # Declared as every other primary key is, but never a client's to choose: a derived
    # row never exists on a device, so no request body carries one (docs/data-model.md).
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The only `ondelete` in the schema. A derived row is not history to be protected, so
    # it follows the match out instead of refusing to let it go; the delete of a match
    # with real point data behind it still has the points to refuse over.
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    set_number: Mapped[int]
    games_won_tracked: Mapped[int]
    games_won_opponent: Mapped[int]
    # Null while the set is in flight: the client stamps `is_set_end` on the point that
    # closes a set, and until one arrives the tally is a score so far, not a result.
    winner: Mapped[MatchSide | None] = mapped_column(str_enum(MatchSide, "set_winner"))
    # clock_timestamp() rather than now(), as everywhere in the schema.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    # onupdate never fires for an upsert, which is an INSERT to SQLAlchemy, so the
    # recompute sets this column itself the way create_player_transfer_code does.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
