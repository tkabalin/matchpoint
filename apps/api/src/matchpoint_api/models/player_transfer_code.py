import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class PlayerTransferCode(Base):
    """An outstanding offer to move one player, and their matches, to another coach.

    Coach A mints the code and hands it over out of band; Coach B redeems it while
    signed in, and the player's `coach_id` moves (#173). Holding the code is the whole
    authorisation, so it is stored the way a session token is: only the SHA-256, over
    256 random bits. There is no `expires_at`, deliberately, so a player can carry the
    code to a coach the current one never meets; cancelling one is a DELETE.
    """

    __tablename__ = "player_transfer_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Unique, so minting again replaces rather than adds: only the hash is kept, so a
    # coach who asks a second time can never be shown the first code again. As on
    # password_resets, the constraint's own index is the one the upsert uses.
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), unique=True)
    # SHA-256 of the code, which is how redeeming finds the row, hence unique.
    # hash_token's rationale holds here as it does not for a six-digit OTP: 256 random
    # bits are unguessable, so the digest's only job is a stolen copy of the table.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # clock_timestamp() rather than now(), as everywhere in the schema.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
