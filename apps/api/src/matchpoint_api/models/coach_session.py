import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class CoachSession(Base):
    """One signed-in client: the server half of the cookie a login sets.

    A row here is what makes the cookie's token mean anything, so deleting the row is
    a complete revocation — the token still exists in the world and stops working
    anyway. That reversibility is why sessions are a table at all rather than a
    stateless signed token; `auth.py` records the comparison.

    `coach_sessions` rather than `sessions`: in a tennis coaching app a "session"
    reads as a training session, and this table must never grow in that direction.
    """

    __tablename__ = "coach_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The signed-in coach. Indexed like every foreign key, and the index is what a
    # "revoke everything this coach holds" delete would filter by.
    coach_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("coaches.id"), index=True)
    # SHA-256 of the cookie token, hex — never the token itself, so a copy of this
    # table (a leaked dump, a misdirected backup) authenticates nobody. Unique because
    # it is the lookup key on every authenticated request; as with the coach email,
    # the constraint's index is the one that lookup uses. 64 is the digest's exact hex
    # length, so unlike the schema's free-text String(100)s this width is a checksum
    # of the writer, not a bound on a person.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # The instant the row stops authenticating. Stored as a deadline and enforced in
    # Python (auth.py), which also slides it forward while the session is in use — so
    # a value in this column says when an *abandoned* login dies, not how long a coach
    # gets to stay signed in.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # clock_timestamp() rather than now(), as everywhere in the schema.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
