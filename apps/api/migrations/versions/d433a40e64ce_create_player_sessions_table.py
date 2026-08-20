"""create player sessions table

Revision ID: d433a40e64ce
Revises: 0c637d5940b9
Create Date: 2026-08-20 20:04:18.771205

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d433a40e64ce"
down_revision: str | Sequence[str] | None = "0c637d5940b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # coach_sessions over again for the second principal type; the model records why
    # it is a separate table rather than a principal column on the existing one.
    op.create_table(
        "player_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        # 64 is SHA-256's exact hex length: the column holds a digest of the cookie
        # token, never the token, so a copy of the table authenticates nobody.
        sa.Column("token_hash", sa.String(length=64), nullable=False),
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
        # No ondelete, as everywhere: deleting a player with live logins is the
        # deleting route's job to handle, by revoking them in the same transaction.
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        # Implemented with an index, which is the one every authenticated player
        # request's session lookup uses, so token_hash carries no index of its own.
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_player_sessions_player_id"), "player_sessions", ["player_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_player_sessions_player_id"), table_name="player_sessions")
    op.drop_table("player_sessions")
