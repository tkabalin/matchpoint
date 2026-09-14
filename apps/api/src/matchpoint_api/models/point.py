import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from matchpoint_api.db import Base
from matchpoint_api.models.match_set import MatchSide
from matchpoint_api.models.types import str_enum


# Every enum below keeps its docstring to one line, as `match.py`'s and `match_set.py`'s
# do: #107's point schemas will name them, which ships the text to the generated
# TypeScript client. Reasoning longer than one line goes in a comment like this instead.
class ServeOutcome(enum.StrEnum):
    """How a single serve attempt landed."""

    # Named IN rather than in, a Python keyword; the stored value is still "in".
    IN = "in"
    FAULT = "fault"
    ACE = "ace"


class CourtSide(enum.StrEnum):
    """One half of the court: a service box, or the far court on the final ball."""

    DEUCE = "deuce"
    AD = "ad"


# Backs the two serve fault modes and the final ball's; a missed return carries the same
# three values through ReturnOutcome instead.
class FailureMode(enum.StrEnum):
    """How a ball that was in play went out."""

    NET = "net"
    LONG = "long"
    WIDE = "wide"


class ReturnOutcome(enum.StrEnum):
    """The return's outcome, set only on a point the opponent served."""

    IN = "in"
    NET = "net"
    LONG = "long"
    WIDE = "wide"


# FORCED covers a standard winner as well as a forced error, the ball being unreachable
# either way, and MISTAKE is a reachable ball missed anyway. There is deliberately no
# clean-winner category (#175).
class EndReason(enum.StrEnum):
    """Why the point ended."""

    FORCED = "forced"
    MISTAKE = "mistake"
    ACE = "ace"
    DOUBLE_FAULT = "double_fault"
    UNUSUAL = "unusual"


class UnusualReason(enum.StrEnum):
    """Why an UNUSUAL point ended, set only alongside that EndReason."""

    NET_TOUCH = "net_touch"
    BALL_HIT_PLAYER = "ball_hit_player"
    REACHED_OVER = "reached_over"
    DOUBLE_HIT = "double_hit"
    HINDRANCE = "hindrance"
    POINT_PENALTY = "point_penalty"
    OTHER = "other"


class Wing(enum.StrEnum):
    FOREHAND = "forehand"
    BACKHAND = "backhand"


# Smash and slice fold into DRIVE and VOLLEY; an overhead is logged as a volley, both
# struck before the bounce.
class ShotType(enum.StrEnum):
    """The last successful shot of the point."""

    DRIVE = "drive"
    VOLLEY = "volley"
    DROPSHOT = "dropshot"
    LOB = "lob"


# Two bands, not three: short against deep is the call a coach can make reliably from
# the sideline, where a middle band is the one nobody agrees on. Capture settled that
# first and the API followed (#248).
class CourtDepth(enum.StrEnum):
    SHORT = "short"
    DEEP = "deep"


# Null on the column means genuinely unknown, never a stand-in for a rally too short to
# bucket.
class RallyBucket(enum.StrEnum):
    """A coarse rally-length bucket, b1 through b4.

    The capture screen the coach taps (`rally-length-screen.tsx`) is what defines these
    ranges; anywhere else a range is displayed or averaged should match it rather than
    settle on its own bounds.
    """

    B1 = "b1"
    B2 = "b2"
    B3 = "b3"
    B4 = "b4"


class Point(Base):
    """One captured point, in the order the capture client assigned it (#175).

    Never corrected in place: a point syncs once its rally is over, and the one
    edit the client makes afterwards is undo, which deletes the row rather than
    rewriting it, so the schema carries no correction or tombstone column. The nine
    stamped score-context columns from `set_number` on are the client scoring
    engine's own answer for this point; the server never replays tennis scoring to
    recover them.
    """

    __tablename__ = "points"
    __table_args__ = (
        # Retried sync flushes are deduplicated on this pair (#107), and its index
        # serves per-match reads, which is why match_id carries no index of its own.
        UniqueConstraint("match_id", "sequence"),
        # Each pair is one fact split over two columns, checked here because a sync
        # payload reaches this table without the ORM having vetted it. Everything
        # conditional on a value rather than on nullness alone (serve2 only after a
        # first-serve fault, end_reason vs unusual_reason, return_outcome only on
        # opponent serves) lives once in #107's ingestion schema instead, so it
        # cannot drift from a second SQL copy of the same rule.
        CheckConstraint("num_nonnulls(wing, shot_type) <> 1", name="point_shot_paired"),
        CheckConstraint("num_nonnulls(ball_half, ball_depth) <> 1", name="point_ball_zone_paired"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    sequence: Mapped[int]
    server: Mapped[MatchSide] = mapped_column(str_enum(MatchSide, "point_server"))
    won: Mapped[bool]

    # Null when nobody watched the serve; a second attempt only ever follows a
    # first-serve fault. Location is null on an opponent serve, placement there being
    # out of scope, and otherwise the box when it landed or a FailureMode when not.
    serve1_outcome: Mapped[ServeOutcome | None] = mapped_column(
        str_enum(ServeOutcome, "point_serve1_outcome")
    )
    serve1_box: Mapped[CourtSide | None] = mapped_column(str_enum(CourtSide, "point_serve1_box"))
    serve1_fault_mode: Mapped[FailureMode | None] = mapped_column(
        str_enum(FailureMode, "point_serve1_fault_mode")
    )
    serve2_outcome: Mapped[ServeOutcome | None] = mapped_column(
        str_enum(ServeOutcome, "point_serve2_outcome")
    )
    serve2_box: Mapped[CourtSide | None] = mapped_column(str_enum(CourtSide, "point_serve2_box"))
    serve2_fault_mode: Mapped[FailureMode | None] = mapped_column(
        str_enum(FailureMode, "point_serve2_fault_mode")
    )

    # Set only on a point the opponent served; a missed return carries its placement
    # here rather than repeating it under wing/shot_type/ball_* below.
    return_outcome: Mapped[ReturnOutcome | None] = mapped_column(
        str_enum(ReturnOutcome, "point_return_outcome")
    )

    # Null when nobody watched the point end, which leaves every column describing
    # the ending null with it.
    end_reason: Mapped[EndReason | None] = mapped_column(str_enum(EndReason, "point_end_reason"))
    unusual_reason: Mapped[UnusualReason | None] = mapped_column(
        str_enum(UnusualReason, "point_unusual_reason")
    )
    # A coach's free-text annotation on any point, not only an unusual one.
    note: Mapped[str | None] = mapped_column(Text)

    # The last successful shot of the point; null on an ace, a double fault, an
    # unusual ending, or a missed return, where return_outcome already places it.
    wing: Mapped[Wing | None] = mapped_column(str_enum(Wing, "point_wing"))
    shot_type: Mapped[ShotType | None] = mapped_column(str_enum(ShotType, "point_shot_type"))

    # Where the final ball landed: half+depth when it stayed in, one of net/long/wide
    # when it didn't. Null throughout on a point with no final ball to record.
    ball_in: Mapped[bool | None]
    ball_half: Mapped[CourtSide | None] = mapped_column(str_enum(CourtSide, "point_ball_half"))
    ball_depth: Mapped[CourtDepth | None] = mapped_column(str_enum(CourtDepth, "point_ball_depth"))
    ball_out_mode: Mapped[FailureMode | None] = mapped_column(
        str_enum(FailureMode, "point_ball_out_mode")
    )

    rally_length_bucket: Mapped[RallyBucket | None] = mapped_column(
        str_enum(RallyBucket, "point_rally_length_bucket")
    )

    set_number: Mapped[int]
    game_number: Mapped[int]
    in_tiebreak: Mapped[bool]
    is_break_point: Mapped[bool]
    is_game_point: Mapped[bool]
    is_game_end: Mapped[bool]
    is_set_point: Mapped[bool]
    is_set_end: Mapped[bool]
    is_match_point: Mapped[bool]

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.clock_timestamp(),
        onupdate=func.clock_timestamp(),
    )
