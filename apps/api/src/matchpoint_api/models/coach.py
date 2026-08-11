import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class Coach(Base):
    """The account a coach signs in with, and the owner of the players they track.

    Every column is NOT NULL: all three are collected by the sign-up form, so a coach
    row that is missing any of them is not an account anyone could sign in to.

    No `archived_at`, unlike Player, because there is no deletion path to offer an
    alternative to: no route deletes a coach, and the foreign key from players refuses a
    hard delete while any of theirs remain. Archiving is what a table offers *instead* of
    deletion, so it belongs with deactivating an account — which also has to stop a
    deactivated coach from signing in, and so is the auth work's to design.
    """

    __tablename__ = "coaches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The sign-in identity, so unique. No separate index=True: Postgres implements a
    # UNIQUE constraint with an index, and that index is the one a login lookup wants.
    # 254 is the longest address SMTP will carry (RFC 5321); the schema bound to pair
    # with it belongs to the sign-up endpoint, which does not exist yet.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # What the coach is called in the app. Intended as a full name, but a nickname is a
    # valid answer, which is why it is one free-text field rather than the
    # first_name/last_name pair on Player — nothing sorts or groups coaches by surname.
    display_name: Mapped[str] = mapped_column(String(100))
    # Text rather than String(n): the value is opaque and never typed by a person, so a
    # width bound guards nothing and would need widening on any change of algorithm.
    # Deliberately absent from CoachRead — nothing reads it back out over the API.
    password_hash: Mapped[str] = mapped_column(Text)
    # clock_timestamp() rather than now() for the reason given on Player.created_at: it
    # is the convention across the schema, so a row's stamps mean the same thing here.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
