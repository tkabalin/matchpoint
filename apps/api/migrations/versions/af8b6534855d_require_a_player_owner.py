"""require a player owner

Revision ID: af8b6534855d
Revises: f7408119da29
Create Date: 2026-08-11 20:09:35.806793

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "af8b6534855d"
down_revision: str | Sequence[str] | None = "f7408119da29"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Players with no coach_id predate sign-in: nothing could set an owner, so every
    # row written before it was orphaned on arrival. There is no coach to assign them
    # to after the fact. Refused rather than deleted: `alembic upgrade head` runs
    # unattended on deploy (infra/prod/deploy.sh), and a silent DELETE there would take
    # real match history with it. Only local dev databases should hold such rows, so
    # failing loudly costs a developer one command and protects everyone else.
    orphans = op.get_bind().scalar(sa.text("SELECT count(*) FROM players WHERE coach_id IS NULL"))
    if orphans:
        raise RuntimeError(
            f"{orphans} player(s) have no coach_id and cannot be assigned an owner. "
            "Delete them (and their matches, since the foreign key declares no "
            "ondelete) before upgrading."
        )
    op.alter_column("players", "coach_id", existing_type=sa.Uuid(), nullable=False)


def downgrade() -> None:
    op.alter_column("players", "coach_id", existing_type=sa.Uuid(), nullable=True)
