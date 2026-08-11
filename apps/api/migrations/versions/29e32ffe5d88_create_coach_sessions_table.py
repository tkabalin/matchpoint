"""create coach sessions table

Revision ID: 29e32ffe5d88
Revises: 73c9a5ad8279
Create Date: 2026-08-11 12:24:11.982307

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "29e32ffe5d88"
down_revision: str | Sequence[str] | None = "73c9a5ad8279"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "coach_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("coach_id", sa.Uuid(), nullable=False),
        # 64 is SHA-256's exact hex length — the column holds a digest of the cookie
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
        sa.ForeignKeyConstraint(["coach_id"], ["coaches.id"]),
        # Implemented with an index, which is the one every authenticated request's
        # session lookup uses — so token_hash carries no index of its own.
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_coach_sessions_coach_id"), "coach_sessions", ["coach_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_coach_sessions_coach_id"), table_name="coach_sessions")
    op.drop_table("coach_sessions")
