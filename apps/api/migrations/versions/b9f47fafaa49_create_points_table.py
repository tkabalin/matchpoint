"""create points table

Revision ID: b9f47fafaa49
Revises: a45c3e8b1f27
Create Date: 2026-08-20 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9f47fafaa49"
down_revision: str | Sequence[str] | None = "a45c3e8b1f27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *members: str) -> sa.Enum:
    return sa.Enum(*members, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    op.create_table(
        "points",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("match_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("server", _enum("point_server", "tracked", "opponent"), nullable=False),
        sa.Column("won", sa.Boolean(), nullable=False),
        sa.Column(
            "serve1_outcome",
            _enum("point_serve1_outcome", "in", "fault", "ace"),
            nullable=False,
        ),
        sa.Column("serve1_box", _enum("point_serve1_box", "deuce", "ad"), nullable=True),
        sa.Column(
            "serve1_target", _enum("point_serve1_target", "wide", "body", "t"), nullable=True
        ),
        sa.Column(
            "serve1_fault_mode",
            _enum("point_serve1_fault_mode", "net", "long", "wide"),
            nullable=True,
        ),
        sa.Column(
            "serve2_outcome",
            _enum("point_serve2_outcome", "in", "fault", "ace"),
            nullable=True,
        ),
        sa.Column("serve2_box", _enum("point_serve2_box", "deuce", "ad"), nullable=True),
        sa.Column(
            "serve2_target", _enum("point_serve2_target", "wide", "body", "t"), nullable=True
        ),
        sa.Column(
            "serve2_fault_mode",
            _enum("point_serve2_fault_mode", "net", "long", "wide"),
            nullable=True,
        ),
        sa.Column(
            "return_outcome",
            _enum("point_return_outcome", "in", "net", "long", "wide"),
            nullable=True,
        ),
        sa.Column(
            "end_reason",
            _enum("point_end_reason", "forced", "mistake", "ace", "double_fault", "unusual"),
            nullable=False,
        ),
        sa.Column(
            "unusual_reason",
            _enum(
                "point_unusual_reason",
                "net_touch",
                "ball_hit_player",
                "reached_over",
                "double_hit",
                "hindrance",
                "point_penalty",
                "other",
            ),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("wing", _enum("point_wing", "forehand", "backhand"), nullable=True),
        sa.Column(
            "shot_type",
            _enum("point_shot_type", "drive", "volley", "dropshot", "lob"),
            nullable=True,
        ),
        sa.Column("ball_in", sa.Boolean(), nullable=True),
        sa.Column("ball_half", _enum("point_ball_half", "deuce", "ad"), nullable=True),
        sa.Column("ball_depth", _enum("point_ball_depth", "short", "mid", "deep"), nullable=True),
        sa.Column(
            "ball_out_mode",
            _enum("point_ball_out_mode", "net", "long", "wide"),
            nullable=True,
        ),
        sa.Column(
            "rally_length_bucket",
            _enum("point_rally_length_bucket", "b1", "b2", "b3", "b4"),
            nullable=True,
        ),
        sa.Column("set_number", sa.Integer(), nullable=False),
        sa.Column("game_number", sa.Integer(), nullable=False),
        sa.Column("in_tiebreak", sa.Boolean(), nullable=False),
        sa.Column("is_break_point", sa.Boolean(), nullable=False),
        sa.Column("is_game_point", sa.Boolean(), nullable=False),
        sa.Column("is_game_end", sa.Boolean(), nullable=False),
        sa.Column("is_set_point", sa.Boolean(), nullable=False),
        sa.Column("is_set_end", sa.Boolean(), nullable=False),
        sa.Column("is_match_point", sa.Boolean(), nullable=False),
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
        sa.CheckConstraint(
            "num_nonnulls(serve1_box, serve1_target) <> 1", name="point_serve1_zone_paired"
        ),
        sa.CheckConstraint(
            "num_nonnulls(serve2_box, serve2_target) <> 1", name="point_serve2_zone_paired"
        ),
        sa.CheckConstraint("num_nonnulls(wing, shot_type) <> 1", name="point_shot_paired"),
        sa.CheckConstraint(
            "num_nonnulls(ball_half, ball_depth) <> 1", name="point_ball_zone_paired"
        ),
        # No ondelete: these are a coach's captured history, refused the way every
        # other child table under matches is, not derived like match_sets.
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.PrimaryKeyConstraint("id"),
        # Ingest dedupes retried flushes on this pair, and its index serves per-match
        # reads, which is why match_id has no index of its own.
        sa.UniqueConstraint("match_id", "sequence"),
    )


def downgrade() -> None:
    op.drop_table("points")
