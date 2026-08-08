"""create players table

Revision ID: 819bf0e5db32
Revises:
Create Date: 2026-08-08 17:35:49.455382

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "819bf0e5db32"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "players",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column(
            "dominant_hand",
            sa.Enum(
                "right", "left", name="dominant_hand", native_enum=False, create_constraint=True
            ),
            nullable=True,
        ),
        sa.Column(
            "gender",
            sa.Enum(
                "male", "female", "other", name="gender", native_enum=False, create_constraint=True
            ),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        # No ForeignKey to coaches: that table does not exist yet. The constraint and
        # its index are added by the migration that creates it.
        sa.Column("coach_id", sa.Uuid(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
    )


def downgrade() -> None:
    op.drop_table("players")
