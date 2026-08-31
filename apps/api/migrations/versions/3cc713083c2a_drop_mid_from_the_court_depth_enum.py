"""drop mid from the court depth enum

Revision ID: 3cc713083c2a
Revises: 36b383a5bcc2
Create Date: 2026-08-31 10:12:00.000000

Capture settled on short against deep in 151b28b and the API never followed, so no
client has been able to produce "mid" since (#248). A row that predates that keeps
its point and loses its placement: the paired CHECK forbids a half without a depth,
and the contract has no zone for a half whose band is unknown. `ball_in` is left
alone, the ball having been in either way.

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3cc713083c2a"
down_revision: str | Sequence[str] | None = "36b383a5bcc2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COURT_DEPTHS = ("short", "deep")
COURT_DEPTHS_WITH_MID = ("short", "mid", "deep")


def _in_list(column: str, values: Sequence[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def upgrade() -> None:
    # Cleared rather than folded into either band: a mid ball was never seen as short
    # or as deep, and picking one would assert a call the coach never made.
    op.execute("UPDATE points SET ball_half = NULL, ball_depth = NULL WHERE ball_depth = 'mid'")
    op.drop_constraint("point_ball_depth", "points", type_="check")
    op.create_check_constraint("point_ball_depth", "points", _in_list("ball_depth", COURT_DEPTHS))


def downgrade() -> None:
    # Widens the constraint back; lossy like every enum-member change here (see
    # str_enum's own docstring), since the placements cleared above stay cleared.
    op.drop_constraint("point_ball_depth", "points", type_="check")
    op.create_check_constraint(
        "point_ball_depth", "points", _in_list("ball_depth", COURT_DEPTHS_WITH_MID)
    )
