import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class PlayerSession(Base):
    """One signed-in player: the server half of the player login's cookie.

    A table of its own rather than a principal column on coach_sessions: the two
    cookies have distinct names, the dependencies that read them join to different
    tables, and "revoke everything this player holds" must never be able to touch a
    coach's logins by a bug in a WHERE. The mechanics mirror CoachSession exactly,
    and its docstring carries the design argument for opaque tokens over JWTs.

    `player_sessions` for `coach_sessions`' naming reason: in a tennis coaching app
    a "session" reads as a training session, and this table must never grow that way.
    """

    __tablename__ = "player_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The signed-in player. Indexed like every foreign key, and the index is what a
    # "revoke everything this player holds" delete filters by.
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), index=True)
    # SHA-256 of the cookie token, hex, never the token: CoachSession.token_hash's
    # reasoning applies unchanged, unique lookup index included.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # A deadline enforced and slid forward in Python (auth.py), like the coach's: a
    # value here says when an abandoned login dies, not how long a player stays in.
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
