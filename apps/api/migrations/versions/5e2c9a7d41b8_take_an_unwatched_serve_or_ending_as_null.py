"""take an unwatched serve or ending as null

Revision ID: 5e2c9a7d41b8
Revises: b2f6d0a91c47
Create Date: 2026-09-03 09:30:00.000000

The capture model records a serve nobody watched as no attempt at all, and an ending
nobody watched as a null end reason (#210). Both columns were NOT NULL, so a point
with either hole could never leave the client. Null now means "not seen", the same
reading the other nullable observation columns already carry.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5e2c9a7d41b8"
down_revision: str | Sequence[str] | None = "b2f6d0a91c47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("points", "serve1_outcome", existing_type=sa.String(5), nullable=True)
    op.alter_column("points", "end_reason", existing_type=sa.String(12), nullable=True)


def downgrade() -> None:
    # Refused rather than deleted, as af8b6534855d refuses: a point with an unwatched
    # serve or ending is still a point the coach recorded, and there is no value to
    # put in its place.
    unwatched = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM points WHERE serve1_outcome IS NULL OR end_reason IS NULL")
    )
    if unwatched:
        raise RuntimeError(
            f"{unwatched} point(s) record an unwatched serve or ending and cannot be made "
            "NOT NULL. Delete them before downgrading."
        )
    op.alter_column("points", "serve1_outcome", existing_type=sa.String(5), nullable=False)
    op.alter_column("points", "end_reason", existing_type=sa.String(12), nullable=False)
