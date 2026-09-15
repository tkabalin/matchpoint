"""add a result reason to matches

Revision ID: c8b3f1e07a45
Revises: a4e17b90c6d2
Create Date: 2026-09-15 09:40:00.000000

Capture already asks how a match ended, and the answer had nowhere to land (#286).
Existing rows keep a null reason: it was never recorded, and "completed" is a member
here rather than the reading of a null, so nothing back-fills a claim.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8b3f1e07a45"
down_revision: str | Sequence[str] | None = "a4e17b90c6d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "result_reason",
            sa.Enum(
                "completed",
                "retirement",
                "walkover",
                "default",
                name="result_reason",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Lossy: how a match ended is stored nowhere else. Dropping the column takes its
    # CHECK constraint with it.
    op.drop_column("matches", "result_reason")
