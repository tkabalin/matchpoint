"""replace the serve boxes with a court side

Revision ID: a4e17b90c6d2
Revises: 7c4e2f9a1b58
Create Date: 2026-09-15 09:10:00.000000

A serve box only ever held the side the point was played from, and only where the
tracked player served, the serve was watched, and it landed (#286). court_side holds
that side on every point instead, which leaves the boxes a partial copy of it.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4e17b90c6d2"
down_revision: str | Sequence[str] | None = "7c4e2f9a1b58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *members: str) -> sa.Enum:
    return sa.Enum(*members, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    op.add_column(
        "points", sa.Column("court_side", _enum("point_court_side", "deuce", "ad"), nullable=True)
    )
    # The side the boxes do hold moves across before they go. At most one of the two is
    # ever set, the ingestion schema allowing a second serve only after a faulted first,
    # so COALESCE cannot pick between two disagreeing values. Every other row keeps a
    # null court_side: the side was never stored there, and inventing one would record a
    # guess as a fact.
    op.execute("UPDATE points SET court_side = COALESCE(serve1_box, serve2_box)")
    # Each drop_column takes its own point_serveN_box CHECK with it.
    op.drop_column("points", "serve1_box")
    op.drop_column("points", "serve2_box")


def downgrade() -> None:
    op.add_column(
        "points", sa.Column("serve1_box", _enum("point_serve1_box", "deuce", "ad"), nullable=True)
    )
    op.add_column(
        "points", sa.Column("serve2_box", _enum("point_serve2_box", "deuce", "ad"), nullable=True)
    )
    # Lossy, and this is the loss the upgrade exists to end: a box can carry the side
    # only on a landed serve of the tracked player's, so every other point goes back to
    # having none. Where a box did belong, the ingestion schema's own rule says which.
    op.execute(
        "UPDATE points SET serve1_box = court_side "
        "WHERE server = 'tracked' AND serve1_outcome IN ('in', 'ace')"
    )
    op.execute(
        "UPDATE points SET serve2_box = court_side "
        "WHERE server = 'tracked' AND serve2_outcome IN ('in', 'ace')"
    )
    op.drop_column("points", "court_side")
