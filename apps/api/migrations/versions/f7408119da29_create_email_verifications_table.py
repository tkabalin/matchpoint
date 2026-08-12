"""create email verifications table

Revision ID: f7408119da29
Revises: 29e32ffe5d88
Create Date: 2026-08-12 21:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7408119da29"
down_revision: str | Sequence[str] | None = "29e32ffe5d88"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_verifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        # Both hashes are SHA-256 hex, hence the exact 64s; both nullable because a
        # row holds exactly one of them — the CHECK below is the invariant.
        sa.Column("otp_hash", sa.String(length=64), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        # One row per address: what lets a re-request replace the old code instead of
        # minting a second concurrently-valid one, and the index request-otp's upsert
        # and verify-otp's lookup both use.
        sa.UniqueConstraint("email"),
        # The lookup key when the row is consumed at sign-up (#44); NULL for every
        # row still at the code stage, which a UNIQUE constraint permits any number of.
        sa.UniqueConstraint("token_hash"),
        # Named and written by hand: autogenerate compares CHECK constraints by name
        # only, so this condition would never be diffed anyway.
        sa.CheckConstraint(
            "num_nonnulls(otp_hash, token_hash) = 1", name="email_verification_one_secret"
        ),
        # By hand for the same reason, and coaches' lowercase constraint over again:
        # the UNIQUE above compares case-sensitively, so this is what stops MIKE@ and
        # mike@ being two rows.
        sa.CheckConstraint("email = lower(email)", name="email_verification_email_lowercase"),
    )


def downgrade() -> None:
    op.drop_table("email_verifications")
