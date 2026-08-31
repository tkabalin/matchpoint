"""create player notes table

Revision ID: b2f6d0a91c47
Revises: 36b383a5bcc2
Create Date: 2026-08-31 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b2f6d0a91c47"
down_revision: str | Sequence[str] | None = "3cc713083c2a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The width of the widest focus area, "technical".
FOCUS_LENGTH = 9


def upgrade() -> None:
    op.create_table(
        "player_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("player_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("recorded_on", sa.Date(), nullable=False),
        sa.Column("focus_areas", postgresql.ARRAY(sa.String(length=FOCUS_LENGTH)), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        # The enum convention's VARCHAR-plus-CHECK, written against the array's elements
        # rather than the column: `<@` is "contained by", so an empty array passes and
        # anything outside the four members does not. Removing a member later is an
        # editable constraint, which is the point of not using a native enum.
        sa.CheckConstraint(
            "focus_areas <@ ARRAY['technical', 'mental', 'physical', 'tactical']::varchar[]",
            name="player_note_focus_areas",
        ),
        # No ondelete: a note is a coach's own writing, refused the way every other
        # child table under players is, so `DELETE /players/{id}` naming it is what
        # takes it out rather than the constraint deciding silently.
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_player_notes_player_id"), "player_notes", ["player_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_player_notes_player_id"), table_name="player_notes")
    op.drop_table("player_notes")
