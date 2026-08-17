"""replace sets format with a scoring system

Revision ID: b1d7c4e9a305
Revises: f8d05f76c7af
Create Date: 2026-08-17 10:12:44.108225

Existing values are discarded rather than translated (#154): `best_of_3` names a set
count, while every scoring system that could be read into it also asserts things about
game scoring and the decider that no coach ever picked. On `matches` that discards
entered data, not just a preference; both columns are nullable, and null reads as the
system never having been stated, which is where an untranslatable value belongs.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1d7c4e9a305"
down_revision: str | Sequence[str] | None = "f8d05f76c7af"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Spelled out here rather than imported from the models: a revision has to keep
# describing the schema it produced, so a later change to the enum leaves this one alone.
SCORING_SYSTEMS = (
    "traditional",
    "mens_grand_slam",
    "womens_grand_slam",
    "no_ad_scoring",
    "match_tiebreak_10_points",
    "short_sets",
    "pro_set",
    "legacy",
)
SETS_FORMATS = ("best_of_1", "best_of_3", "best_of_5")


def _enum(name: str, values: Sequence[str]) -> sa.Enum:
    """VARCHAR + CHECK, matching what `str_enum` emits for these columns."""
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    # Drop and add rather than an in-place rename: the values do not carry over (see
    # the revision note), so a rename plus a type change plus a blanket UPDATE to NULL
    # would be three statements saying what these two say.
    op.drop_column("matches", "sets_format")
    op.add_column(
        "matches",
        sa.Column("scoring_system", _enum("scoring_system", SCORING_SYSTEMS), nullable=True),
    )
    op.drop_column("coaches", "default_sets_format")
    op.add_column(
        "coaches",
        sa.Column(
            "default_scoring_system",
            _enum("default_scoring_system", SCORING_SYSTEMS),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Symmetrical, and lossy in this direction too: a scoring system cannot be reduced
    # to a set count without inventing the part it does not state.
    op.drop_column("coaches", "default_scoring_system")
    op.add_column(
        "coaches",
        sa.Column("default_sets_format", _enum("default_sets_format", SETS_FORMATS), nullable=True),
    )
    op.drop_column("matches", "scoring_system")
    op.add_column(
        "matches", sa.Column("sets_format", _enum("sets_format", SETS_FORMATS), nullable=True)
    )
