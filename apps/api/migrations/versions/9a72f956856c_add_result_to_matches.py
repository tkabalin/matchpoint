"""add result to matches

Revision ID: 9a72f956856c
Revises: bdc7cd08dddd
Create Date: 2026-08-15 13:42:51.694047

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a72f956856c"
down_revision: str | Sequence[str] | None = "bdc7cd08dddd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "result",
            sa.Enum("win", "loss", name="result", native_enum=False, create_constraint=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Dropping the column takes its CHECK constraint with it.
    op.drop_column("matches", "result")
