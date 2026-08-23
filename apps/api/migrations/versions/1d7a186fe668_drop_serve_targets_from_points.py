"""drop serve targets from points

Revision ID: 1d7a186fe668
Revises: d433a40e64ce
Create Date: 2026-08-23 11:57:44.607768

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1d7a186fe668"
down_revision: str | Sequence[str] | None = "d433a40e64ce"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *members: str) -> sa.Enum:
    return sa.Enum(*members, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    # These paired the box with the target; with the target gone there is nothing
    # left to pair the box against.
    op.drop_constraint("point_serve1_zone_paired", "points", type_="check")
    op.drop_constraint("point_serve2_zone_paired", "points", type_="check")
    # Each drop_column takes its own point_serveN_target CHECK with it.
    op.drop_column("points", "serve1_target")
    op.drop_column("points", "serve2_target")


def downgrade() -> None:
    op.add_column(
        "points",
        sa.Column(
            "serve1_target", _enum("point_serve1_target", "wide", "body", "t"), nullable=True
        ),
    )
    op.add_column(
        "points",
        sa.Column(
            "serve2_target", _enum("point_serve2_target", "wide", "body", "t"), nullable=True
        ),
    )
    op.create_check_constraint(
        "point_serve1_zone_paired", "points", "num_nonnulls(serve1_box, serve1_target) <> 1"
    )
    op.create_check_constraint(
        "point_serve2_zone_paired", "points", "num_nonnulls(serve2_box, serve2_target) <> 1"
    )
