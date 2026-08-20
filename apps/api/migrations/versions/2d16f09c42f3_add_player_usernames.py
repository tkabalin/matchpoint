"""add player usernames

Revision ID: 2d16f09c42f3
Revises: e4d1c9b7a028
Create Date: 2026-08-20 18:41:07.512843

"""

import re
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2d16f09c42f3"
down_revision: str | Sequence[str] | None = "e4d1c9b7a028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# A frozen copy of usernames.username_prefix and its helpers, not an import: this
# revision replays on every fresh deploy, so importing the live functions would let a
# later change to them quietly rewrite which usernames this backfill minted.

_VOWELS = frozenset("aeiou")


def _letters(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z]", "", stripped.casefold())


def _prefix(first_name: str, last_name: str) -> str:
    surname = _letters(last_name)
    if surname:
        consonants = "".join(char for char in surname[1:] if char not in _VOWELS)
        vowels = "".join(char for char in surname[1:] if char in _VOWELS)
        surname = surname[0] + consonants + vowels
    return (surname + "xxx")[:3] + (_letters(first_name) + "xxx")[:3]


def upgrade() -> None:
    # Added nullable, backfilled, then tightened: players predating usernames need
    # theirs minted before the NOT NULL can hold.
    op.add_column("players", sa.Column("username", sa.String(length=20), nullable=True))

    connection = op.get_bind()
    # Oldest row first, id as the tiebreaker, so namesakes are numbered
    # deterministically: the same data always backfills to the same usernames.
    rows = connection.execute(
        sa.text("SELECT id, first_name, last_name FROM players ORDER BY created_at, id")
    ).all()
    counts: dict[str, int] = {}
    for player_id, first_name, last_name in rows:
        prefix = _prefix(first_name, last_name)
        counts[prefix] = counts.get(prefix, 0) + 1
        connection.execute(
            sa.text("UPDATE players SET username = :username WHERE id = :id"),
            {"username": f"{prefix}{counts[prefix]:03d}", "id": player_id},
        )

    op.alter_column("players", "username", nullable=False)
    # Named as Postgres would name it inline, matching the model's bare unique=True.
    op.create_unique_constraint("players_username_key", "players", ["username"])


def downgrade() -> None:
    # The constraint goes with its column. The minted usernames are lost, which is the
    # point of the backfill being deterministic: upgrading again mints the same ones.
    op.drop_column("players", "username")
