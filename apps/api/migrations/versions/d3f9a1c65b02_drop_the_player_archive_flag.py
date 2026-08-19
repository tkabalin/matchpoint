"""drop the player archive flag

Revision ID: d3f9a1c65b02
Revises: c7a3e1b40d69
Create Date: 2026-08-19 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3f9a1c65b02"
down_revision: str | Sequence[str] | None = "c7a3e1b40d69"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Players are deleted outright now (#188), so there is no archived state for the
    # column to hold. The rows stay and rejoin the roster: archiving was reversible, so
    # erasing them here would destroy data nobody asked to lose.
    op.drop_column("players", "archived_at")


def downgrade() -> None:
    # Nullable, so the column comes back the shape it left in. The timestamps it held
    # cannot come back, since nothing else recorded them.
    op.add_column("players", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
