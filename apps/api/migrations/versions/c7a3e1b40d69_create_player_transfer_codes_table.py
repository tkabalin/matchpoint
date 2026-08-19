"""create player transfer codes table

Revision ID: c7a3e1b40d69
Revises: 4b2ca7d1e6f3
Create Date: 2026-08-18 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7a3e1b40d69"
down_revision: str | Sequence[str] | None = "4b2ca7d1e6f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "player_transfer_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        # SHA-256 hex, hence the exact 64.
        sa.Column("token_hash", sa.String(length=64), nullable=False),
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
        # No ondelete, as on every foreign key here: a row that survives its player
        # would be a code for nothing, so the route that deletes a player says what
        # becomes of the code rather than the constraint deciding silently.
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        # One live code per player, which is what makes minting again a replacement,
        # and the index the upsert uses.
        sa.UniqueConstraint("player_id"),
        # Redeeming looks the row up by this value.
        sa.UniqueConstraint("token_hash"),
    )


def downgrade() -> None:
    op.drop_table("player_transfer_codes")
