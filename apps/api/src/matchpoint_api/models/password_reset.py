import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class PasswordReset(Base):
    """One account part-way through resetting its password with an emailed code.

    EmailVerification's shape, stage for stage (#149): forgot-password writes
    `otp_hash`, verify-reset-code trades it for `token_hash`, and the reset that
    presents that token consumes the row. Two stages so the code can be answered on
    a screen of its own, ahead of the one that chooses the password. Keyed on the
    coach rather than an address because the row is about an account that exists,
    the opposite of a verification's premise, and `UNIQUE(coach_id)` plus an upsert
    makes a re-request *replace* the old code.

    The prize for cracking a code here is the account itself, not sign-up's right
    to register an unowned address. The bounds are the same even so: the attempt
    cap below, the short expiry, and forgot-password's per-email tier on minting —
    and every code mailed to the owner is the probe announcing itself.
    """

    __tablename__ = "password_resets"
    __table_args__ = (
        # Exactly one of the two secrets, always, as on email_verifications: a row is
        # either an unanswered code or an answered proof, and the database holds that
        # line against writers that skip the ORM.
        CheckConstraint("num_nonnulls(otp_hash, token_hash) = 1", name="password_reset_one_secret"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The account whose password the code can set. Unique — one live reset per
    # coach — and as with the coach email, the constraint's index is the one the
    # upsert and the reset lookup use.
    coach_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("coaches.id"), unique=True)
    # SHA-256 of the emailed code, with EmailVerification.otp_hash's caveat: the
    # digest keeps the plaintext out of a copy of the table and bounds nothing.
    # Nullable because a row that has answered its code holds the token instead.
    otp_hash: Mapped[str | None] = mapped_column(String(64))
    # SHA-256 of the reset cookie's token, once the code has been answered. 256
    # random bits, so hash_token's rationale genuinely holds for this column.
    # Unique because reset-password looks the row up by this value.
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    # Wrong guesses against the current code, counted in the database for
    # EmailVerification's reason: rate_limit.py's counters die on deploy.
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # When the current state stops being answerable: the code's deadline first, then
    # rewritten to the reset cookie's own on success. Never renewed, being a
    # single-purpose credential, as the verification's is.
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
