"""drop womens grand slam as a distinct scoring system

Revision ID: 36b383a5bcc2
Revises: 1d7a186fe668
Create Date: 2026-08-27 13:26:06.417016

`docs/scoring-systems.md` already recorded it as differing from Traditional in nothing —
a label with no rule of its own. "Traditional" absorbs both: existing rows are
backfilled before the narrower CHECK lands, so the constraint is never violated
mid-migration.

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "36b383a5bcc2"
down_revision: str | Sequence[str] | None = "1d7a186fe668"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCORING_SYSTEMS = (
    "traditional",
    "mens_grand_slam",
    "no_ad_scoring",
    "match_tiebreak_10_points",
    "short_sets",
    "pro_set",
    "legacy",
)
SCORING_SYSTEMS_WITH_WOMENS_GRAND_SLAM = (
    "traditional",
    "mens_grand_slam",
    "womens_grand_slam",
    "no_ad_scoring",
    "match_tiebreak_10_points",
    "short_sets",
    "pro_set",
    "legacy",
)


def _in_list(column: str, values: Sequence[str]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def upgrade() -> None:
    op.execute(
        "UPDATE matches SET scoring_system = 'traditional' "
        "WHERE scoring_system = 'womens_grand_slam'"
    )
    op.execute(
        "UPDATE coaches SET default_scoring_system = 'traditional' "
        "WHERE default_scoring_system = 'womens_grand_slam'"
    )
    op.drop_constraint("scoring_system", "matches", type_="check")
    op.create_check_constraint(
        "scoring_system", "matches", _in_list("scoring_system", SCORING_SYSTEMS)
    )
    op.drop_constraint("default_scoring_system", "coaches", type_="check")
    op.create_check_constraint(
        "default_scoring_system", "coaches", _in_list("default_scoring_system", SCORING_SYSTEMS)
    )


def downgrade() -> None:
    # Widens the constraint back; lossy like every enum-member change here (see
    # str_enum's own docstring) — the rows folded into "traditional" above stay
    # there rather than un-migrating back to "womens_grand_slam".
    op.drop_constraint("scoring_system", "matches", type_="check")
    op.create_check_constraint(
        "scoring_system",
        "matches",
        _in_list("scoring_system", SCORING_SYSTEMS_WITH_WOMENS_GRAND_SLAM),
    )
    op.drop_constraint("default_scoring_system", "coaches", type_="check")
    op.create_check_constraint(
        "default_scoring_system",
        "coaches",
        _in_list("default_scoring_system", SCORING_SYSTEMS_WITH_WOMENS_GRAND_SLAM),
    )
