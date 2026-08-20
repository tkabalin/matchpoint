import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func, select
from sqlalchemy.orm import Mapped, column_property, mapped_column

from matchpoint_api import photos
from matchpoint_api.db import Base
from matchpoint_api.models.player_transfer_code import PlayerTransferCode
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
    # The player's sign-in identifier, minted by the server (usernames.py) and never
    # chosen by a client: six letters folded from the name plus a number from 001, the
    # student-number shape. Always stored lowercase, so login can fold what was typed.
    # String(20) leaves the number room the format can widen into past 999.
    username: Mapped[str] = mapped_column(String(20), unique=True)
    # Argon2 of the password the coach was shown once (auth.new_player_password), or
    # NULL for a row that predates player sign-in and has not had one minted since.
    # Argon2 rather than hash_token's plain digest: a player types this at login, so
    # it is a guessable secret, not a 256-bit token.
    password_hash: Mapped[str | None] = mapped_column(Text)
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
    # The photo store's name for this player's photo, null for the initials avatar the
    # app falls back to. Text for the reason Coach.photo_key is: an opaque value nobody
    # types, where a width bound guards nothing and would need widening later.
    photo_key: Mapped[str | None] = mapped_column(Text)
    # The owning coach, set by the route from the session — never from the request
    # body, which is why PlayerCreate does not carry it. No ondelete, so Postgres
    # refuses to delete a coach who still has players rather than taking their match
    # history along. Indexed because Postgres does not index a foreign key
    # automatically, and the roster query — one coach's players — filters on it.
    coach_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("coaches.id"), index=True)
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
    # Derived, never stored: a row in player_transfer_codes is the whole definition of a
    # live code, since there is no expiry and cancelling or redeeming one deletes it. As
    # a column_property it rides in the same SELECT the player comes back in, so the
    # roster reads it for the whole list at once and the 409s reuse this one predicate.
    has_transfer_code: Mapped[bool] = column_property(
        select(PlayerTransferCode.id)
        .where(PlayerTransferCode.player_id == id)
        .exists()
        .correlate_except(PlayerTransferCode)
    )

    @property
    def photo_url(self) -> str | None:
        """Where this player's photo is served, or None. Read through from_attributes."""
        return photos.url_for(self.photo_key)
