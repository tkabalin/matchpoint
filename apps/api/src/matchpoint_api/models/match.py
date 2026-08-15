import enum
import uuid
from datetime import date, datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.types import str_enum


# Surface and SetsFormat back a preference column on coaches too, so a member added or
# removed here needs the CHECK constraint on both tables migrated. Alembic compares a
# CHECK by name and never by condition, so nothing reports the one left behind.
class Surface(enum.StrEnum):
    HARD = "hard"
    CLAY = "clay"
    GRASS = "grass"
    CARPET = "carpet"


# Named for the one axis it models, not "format": real tennis also varies by game
# scoring (ad vs no-ad), set length (first to 6 vs Fast4's 4) and tiebreak type
# (7-point vs a 10-point match tiebreak). Those can arrive as their own fields if the
# client asks for them, rather than multiplying combinations into this enum. Docstring
# kept to one line because it ships to the generated TypeScript client.
class SetsFormat(enum.StrEnum):
    """How many sets the match is played over."""

    BEST_OF_1 = "best_of_1"
    BEST_OF_3 = "best_of_3"
    BEST_OF_5 = "best_of_5"


# Docstring kept to one line for the reason given on SetsFormat.
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
    sets_format: Mapped[SetsFormat | None] = mapped_column(str_enum(SetsFormat, "sets_format"))
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
