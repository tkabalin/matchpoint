import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base


class EmailVerification(Base):
    """One address part-way through proving itself at sign-up.

    The row transitions state rather than splitting into two tables: request-otp
    writes `otp_hash`, verify-otp trades it for `token_hash`, and the sign-up that
    presents the token consumes the row (#44). One row per address — `UNIQUE(email)`
    plus an upsert makes a re-request *replace* the abandoned row, so there is only
    ever one live code per address and the table stays bounded by the addresses seen
    within an expiry window. Cleanup is schema, not a sweep this table would
    otherwise be owed.

    No foreign key to coaches, deliberately: the whole point of the row is that no
    coach exists yet. An address that already has an account is refused a row (the
    409), so cracking a code only ever wins the right to register an address the
    attacker does not own.
    """

    __tablename__ = "email_verifications"
    __table_args__ = (
        # Exactly one of the two secrets, always: a row is either an unanswered code
        # or a proven verification, and the database holds that line against writers
        # that skip the ORM — as coach_email_lowercase does for casing.
        CheckConstraint(
            "num_nonnulls(otp_hash, token_hash) = 1", name="email_verification_one_secret"
        ),
        # Lowercased for coaches.email's reason — UNIQUE compares case-sensitively, so
        # without this MIKE@ and mike@ are two rows and one live code per address stops
        # being true. Unlike Coach there is no `validates` normaliser paired with it:
        # request-otp writes this table through a Core upsert, which never runs one, so
        # the constraint is not a backstop here but the whole enforcement.
        CheckConstraint("email = lower(email)", name="email_verification_email_lowercase"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The row's identity, not just a lookup key: one live verification per address is
    # what keeps "resend" meaning *replace* rather than a second concurrently-valid
    # code. Stored lowercased, held by the CHECK above as coaches.email is; width
    # paired with EMAIL_MAX_LENGTH the same way.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # SHA-256 of the emailed code — but unlike coach_sessions.token_hash the digest is
    # *not* the defence here: a six-digit code is ~20 bits, swept in milliseconds by
    # anything that holds this column. The attempt cap below and the short expiry are
    # what bound guessing; auth.py's hash_otp says why Argon2 is not the answer either.
    otp_hash: Mapped[str | None] = mapped_column(String(64))
    # SHA-256 of the verification cookie's token, once the code has been answered.
    # 256 random bits, so hash_token's rationale genuinely holds for this column.
    # Unique because consuming the row (#44) looks it up by this value.
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    # Wrong guesses against the current code. In the database rather than a
    # rate_limit.py bucket, because those counters die on deploy — and a guessing
    # bound that resets on every deploy is not a bound.
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    # When the current state stops being answerable: the code's deadline first, then
    # rewritten to the (shorter) verification-cookie deadline on success. Never
    # renewed — a sliding single-purpose credential would defeat its point.
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
