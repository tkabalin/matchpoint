"""create match sets table

Revision ID: a45c3e8b1f27
Revises: f989e0ca10e9
Create Date: 2026-08-19 10:24:36.118204

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a45c3e8b1f27"
down_revision: str | Sequence[str] | None = "f989e0ca10e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "match_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("games_won_tracked", sa.Integer(), nullable=False),
        sa.Column("games_won_opponent", sa.Integer(), nullable=False),
        sa.Column(
            "winner",
            sa.Enum(
                "tracked",
                "opponent",
                name="set_winner",
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
        # The one ON DELETE in the schema: these rows are derived from the match's
        # points, so they follow the match out rather than refuse to let it go.
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        # Ingest upserts on this pair, and its index serves lookups by match, which is
        # why match_id has no index of its own.
        sa.UniqueConstraint("match_id", "set_number"),
    )


def downgrade() -> None:
    op.drop_table("match_sets")
