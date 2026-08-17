import enum
import uuid
from datetime import date, datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.types import str_enum


# Surface and ScoringSystem back a preference column on coaches too, so a member added
# or removed here needs the CHECK constraint on both tables migrated. Alembic compares a
# CHECK by name and never by condition, so nothing reports the one left behind.
class Surface(enum.StrEnum):
    HARD = "hard"
    CLAY = "clay"
    GRASS = "grass"
    CARPET = "carpet"


# The named systems from #154's table, replacing the sets-count-only SetsFormat. Each is
# an opaque label here: what it implies about game scoring, set length and the decider is
# the client's, and these values are exactly the web capture model's ScoringSystem union
# so neither side needs a translation table. Docstring kept to one line because it ships
# to the generated TypeScript client.
class ScoringSystem(enum.StrEnum):
    """The scoring system the match is played under."""

    TRADITIONAL = "traditional"
    MENS_GRAND_SLAM = "mens_grand_slam"
    WOMENS_GRAND_SLAM = "womens_grand_slam"
    NO_AD_SCORING = "no_ad_scoring"
    MATCH_TIEBREAK_10_POINTS = "match_tiebreak_10_points"
    SHORT_SETS = "short_sets"
    PRO_SET = "pro_set"
    # "Advantage set (no-tiebreak decider)" in #154's table, under the name the web
    # capture model already ships for it.
    LEGACY = "legacy"


# Docstring kept to one line for the reason given on ScoringSystem.
class MatchResult(enum.StrEnum):
    """Whether the tracked player won, from their side and never the opponent's."""

    WIN = "win"
    LOSS = "loss"


class Match(Base):
    """Match metadata only — score/set/point structure belongs to the scoring engine work."""

    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The coach's tracked player. The opponent is free text, not a foreign key:
    # opponents are usually not in the coach's roster. Indexed because every
    # analytics query filters matches by player.
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), index=True)
    opponent_name: Mapped[str | None] = mapped_column(String(100))
    played_on: Mapped[date]
    surface: Mapped[Surface | None] = mapped_column(str_enum(Surface, "surface"))
    event: Mapped[str | None] = mapped_column(String(100))
    scoring_system: Mapped[ScoringSystem | None] = mapped_column(
        str_enum(ScoringSystem, "scoring_system")
    )
    # Stored rather than derived from point data (#94): capture is optional, so
    # many matches will only ever have a result. Null until recorded; the scoring
    # engine can set it at match end once point capture exists.
    result: Mapped[MatchResult | None] = mapped_column(str_enum(MatchResult, "result"))
    # clock_timestamp(), not now(): now() is the transaction timestamp, so a batch of
    # matches synced in one transaction would all claim the same creation time and the
    # created_at tiebreaker in list_matches would order them arbitrarily.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
