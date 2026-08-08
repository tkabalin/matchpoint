import enum
import uuid
from datetime import date, datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.types import str_enum


class Surface(enum.StrEnum):
    HARD = "hard"
    CLAY = "clay"
    GRASS = "grass"
    CARPET = "carpet"


class MatchFormat(enum.StrEnum):
    BEST_OF_1 = "best_of_1"
    BEST_OF_3 = "best_of_3"
    BEST_OF_5 = "best_of_5"


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
    format: Mapped[MatchFormat | None] = mapped_column(str_enum(MatchFormat, "match_format"))
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
