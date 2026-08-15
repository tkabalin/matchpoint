"""add match setup defaults to coaches

Revision ID: f8d05f76c7af
Revises: 9a72f956856c
Create Date: 2026-08-15 18:54:21.261436

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f8d05f76c7af"
down_revision: str | Sequence[str] | None = "9a72f956856c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: existing coaches simply hold no preference yet (#97).
    op.add_column(
        "coaches",
        sa.Column(
            "default_surface",
            sa.Enum(
                "hard",
                "clay",
                "grass",
                "carpet",
                name="default_surface",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "coaches",
        sa.Column(
            "default_sets_format",
            sa.Enum(
                "best_of_1",
                "best_of_3",
                "best_of_5",
                name="default_sets_format",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Dropping each column takes its CHECK constraint with it.
    op.drop_column("coaches", "default_sets_format")
    op.drop_column("coaches", "default_surface")
