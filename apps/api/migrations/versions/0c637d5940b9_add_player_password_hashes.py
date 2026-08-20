"""add player password hashes

Revision ID: 0c637d5940b9
Revises: 2d16f09c42f3
Create Date: 2026-08-20 19:52:31.208467

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0c637d5940b9"
down_revision: str | Sequence[str] | None = "2d16f09c42f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default, and no backfill: a password is minted and shown to the
    # coach exactly once, which nothing replayed at deploy time can do. NULL means
    # the player cannot sign in until their coach mints one.
    op.add_column("players", sa.Column("password_hash", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("players", "password_hash")
