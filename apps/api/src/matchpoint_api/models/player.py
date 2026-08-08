import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.types import str_enum


class DominantHand(enum.StrEnum):
    RIGHT = "right"
    LEFT = "left"


class Gender(enum.StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class Player(Base):
    __tablename__ = "players"

    # UUID rather than a serial: ids must be assignable by the client, so a row
    # created during offline capture keeps a stable identity once it reaches the
    # server.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Two columns rather than one `name`: rosters and analytics group and sort by
    # surname, and a single field cannot be split back into parts reliably —
    # "van der Merwe" and "Alcaraz Garfia" both defeat splitting on the last space.
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    # Everything past the name is nullable: player profiles must be quick to set
    # up, so nothing beyond the two name parts is required.
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    dominant_hand: Mapped[DominantHand | None] = mapped_column(
        str_enum(DominantHand, "dominant_hand")
    )
    gender: Mapped[Gender | None] = mapped_column(str_enum(Gender, "gender"))
    # Text rather than String(n): coach notes are prose, and the length bound belongs
    # on the schema, where it reaches the OpenAPI spec and so the client form.
    notes: Mapped[str | None] = mapped_column(Text)
    # The owning coach. Deliberately not a ForeignKey yet — the coaches table does not
    # exist; the constraint and its index are added by the migration that creates it.
    # (Postgres does not index a foreign key automatically, so the two belong together.)
    coach_id: Mapped[uuid.UUID | None]
    # Soft deletion: a player who has matches recorded against them cannot be deleted
    # outright without taking the match history along, so archiving is the only safe
    # way to clear someone off an active roster.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # clock_timestamp(), not now(): now() is the transaction timestamp, so a batch of
    # rows written in one transaction would all claim the same creation time.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
