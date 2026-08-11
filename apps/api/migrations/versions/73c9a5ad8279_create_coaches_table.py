"""create coaches table

Revision ID: 73c9a5ad8279
Revises: 508b67f5f3c6
Create Date: 2026-08-11 11:07:24.852067

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "73c9a5ad8279"
down_revision: str | Sequence[str] | None = "508b67f5f3c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "coaches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
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
        # Postgres implements this with an index, which is the one a login lookup uses,
        # so email carries no index of its own.
        sa.UniqueConstraint("email"),
    )
    # The constraint and index that the players revision deferred to this one. Named
    # rather than left to Postgres so the downgrade below has something to drop — and
    # named what Postgres itself would have chosen, so the constraint is identical to
    # one declared inline in a create_table.
    op.create_index(op.f("ix_players_coach_id"), "players", ["coach_id"], unique=False)
    op.create_foreign_key("players_coach_id_fkey", "players", "coaches", ["coach_id"], ["id"])


def downgrade() -> None:
    # The foreign key goes first: dropping coaches while players still references it
    # would fail. Existing rows need no attention — coach_id is nullable and nothing
    # writes it yet, so this only removes a constraint, never data.
    op.drop_constraint("players_coach_id_fkey", "players", type_="foreignkey")
    op.drop_index(op.f("ix_players_coach_id"), table_name="players")
    op.drop_table("coaches")
