"""create score checkpoints table

Revision ID: 7c4e2f9a1b58
Revises: 5e2c9a7d41b8
Create Date: 2026-09-14 16:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "7c4e2f9a1b58"
down_revision: str | Sequence[str] | None = "5e2c9a7d41b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "score_checkpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column(
            "serves_next",
            sa.Enum(
                "tracked",
                "opponent",
                name="score_checkpoint_serves_next",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("order_changed", sa.Boolean(), nullable=False),
        # The declared scoreboard as one document: the server reads it in one place and
        # never queries inside it, so a child table would be plumbing for nothing.
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        # No ondelete, as on points: the routes that delete a match erase these by hand.
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.PrimaryKeyConstraint("id"),
        # Retried flushes deduplicate on this pair, and its index serves lookups by
        # match, which is why match_id has no index of its own.
        sa.UniqueConstraint("match_id", "sequence"),
    )


def downgrade() -> None:
    op.drop_table("score_checkpoints")
