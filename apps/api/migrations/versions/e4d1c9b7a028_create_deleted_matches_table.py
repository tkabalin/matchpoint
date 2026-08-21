"""create deleted matches table

Revision ID: e4d1c9b7a028
Revises: b9f47fafaa49
Create Date: 2026-08-21 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4d1c9b7a028"
down_revision: str | Sequence[str] | None = "b9f47fafaa49"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deleted_matches",
        # No foreign key to matches: the row this id named has been deleted.
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("coach_id", sa.Uuid(), nullable=False),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["coach_id"], ["coaches.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_deleted_matches_coach_id"), "deleted_matches", ["coach_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_deleted_matches_coach_id"), table_name="deleted_matches")
    op.drop_table("deleted_matches")
