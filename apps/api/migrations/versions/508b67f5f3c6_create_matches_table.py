"""create matches table

Revision ID: 508b67f5f3c6
Revises: 819bf0e5db32
Create Date: 2026-08-08 17:48:18.724155

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "508b67f5f3c6"
down_revision: str | Sequence[str] | None = "819bf0e5db32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "matches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        sa.Column("opponent_name", sa.String(length=100), nullable=True),
        sa.Column("played_on", sa.Date(), nullable=False),
        sa.Column(
            "surface",
            sa.Enum(
                "hard",
                "clay",
                "grass",
                "carpet",
                name="surface",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column("event", sa.String(length=100), nullable=True),
        sa.Column(
            "format",
            sa.Enum(
                "best_of_1",
                "best_of_3",
                "best_of_5",
                name="match_format",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
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
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_matches_player_id"), "matches", ["player_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_matches_player_id"), table_name="matches")
    op.drop_table("matches")
