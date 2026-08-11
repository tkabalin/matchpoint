import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, validates

from matchpoint_api.db import Base


class Coach(Base):
    """The account a coach signs in with, and the owner of the players they track.

    Every column is NOT NULL: all three are collected by the sign-up form, so a coach
    row that is missing any of them is not an account anyone could sign in to.

    No `archived_at`, unlike Player, because there is no deletion path to offer an
    alternative to: no route deletes a coach, and the foreign key from players refuses a
    hard delete while any of theirs remain. Archiving is what a table offers *instead*
    of deletion, so here it would mean deactivating the account. The login work (#24)
    weighed adding it and declined: nothing can set it — there is no admin surface and
    no self-service closure — so the column would be written by nobody and the sign-in
    check reading it would guard a state no code can produce. When a deactivation path
    arrives, it brings three things as one piece of work: this column, the login check
    that refuses the deactivated, and the revocation of their live coach_sessions rows.
    """

    __tablename__ = "coaches"
    __table_args__ = (
        # Addresses are stored lowercased, and the database is what holds the line: a
        # UNIQUE constraint compares case-sensitively, so without this Mike@ and mike@
        # are two accounts, each owning a separate roster, and a login looking up the
        # address as typed misses whichever row it was not stored as. `validates` below
        # normalises every write through the ORM, and this refuses anything that did
        # not come through it.
        CheckConstraint("email = lower(email)", name="coach_email_lowercase"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The sign-in identity, so unique. No separate index=True: Postgres implements a
    # UNIQUE constraint with an index, and that index is the one a login lookup wants.
    # 254 is the longest address SMTP will carry (RFC 5321), paired with CoachCreate's
    # EMAIL_MAX_LENGTH so a too-long address is rejected as a 422 rather than a 500.
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

    @validates("email")
    def _normalise_email(self, _key: str, email: str) -> str:
        """Lowercase on the way in, so a coach signing in as MIKE@ finds their account.

        Here rather than in a schema because it is the column's invariant, not one
        endpoint's: sign-up, an admin fixture and a future import all write this row,
        and only one of them would go through a request body. Case is all that is
        normalised — surrounding whitespace and the address's validity are the sign-up
        schema's to reject, where the coach can be told about it.
        """
        return email.lower()
