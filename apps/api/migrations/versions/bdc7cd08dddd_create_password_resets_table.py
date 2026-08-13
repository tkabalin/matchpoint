"""create password resets table

Revision ID: bdc7cd08dddd
Revises: af8b6534855d
Create Date: 2026-08-13 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bdc7cd08dddd"
down_revision: str | Sequence[str] | None = "af8b6534855d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("coach_id", sa.Uuid(), nullable=False),
        # SHA-256 hex, hence the exact 64. NOT NULL, unlike email_verifications'
        # pair of hashes: this row has no second state to transition to.
        sa.Column("otp_hash", sa.String(length=64), nullable=False),
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
        # No ondelete, as on every foreign key here: nothing deletes a coach, and if
        # something ever tries, a pending reset should refuse rather than vanish.
        sa.ForeignKeyConstraint(["coach_id"], ["coaches.id"]),
        # One live reset per coach: what lets a re-request replace the old code
        # instead of minting a second concurrently-valid one, and the index the
        # upsert and the reset lookup both use.
        sa.UniqueConstraint("coach_id"),
    )


def downgrade() -> None:
    op.drop_table("password_resets")
