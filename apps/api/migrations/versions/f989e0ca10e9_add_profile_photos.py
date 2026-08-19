"""add profile photos

Revision ID: f989e0ca10e9
Revises: c7a3e1b40d69
Create Date: 2026-08-19 15:11:42.435169

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f989e0ca10e9"
down_revision: str | Sequence[str] | None = "c7a3e1b40d69"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: everyone who already exists has no photo, which is the app's
    # initials avatar. The column holds the photo store's filename, never the bytes and
    # never the URL — docs/data-model.md records why the file lives outside the database.
    op.add_column("coaches", sa.Column("photo_key", sa.Text(), nullable=True))
    op.add_column("players", sa.Column("photo_key", sa.Text(), nullable=True))


def downgrade() -> None:
    # The stored files outlive this, unreferenced: nothing here can reach the media
    # directory, and dropping the names is not a reason to delete what they pointed at.
    op.drop_column("players", "photo_key")
    op.drop_column("coaches", "photo_key")
