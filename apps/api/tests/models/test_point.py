import enum
import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import (
    CourtDepth,
    CourtSide,
    EndReason,
    FailureMode,
    Match,
    MatchSide,
    Point,
    RallyBucket,
    ReturnOutcome,
    ServeOutcome,
    ServeTarget,
    ShotType,
    UnusualReason,
    Wing,
)
from tests.factories import make_match, make_point


def test_point_round_trips_with_the_minimal_shape(db_session: Session) -> None:
    """A tracked-player serve, first serve in, no rally beyond it. The smallest shape
    the TS contract allows: one serve attempt, no return, and every stamp filled."""
    match = make_match(db_session)
    point = make_point(db_session, match_id=match.id)
    db_session.commit()

    saved = db_session.get(Point, point.id)
    assert saved is not None
    assert saved.match_id == match.id
    assert saved.sequence == 0
    assert saved.server is MatchSide.TRACKED
    assert saved.won is True
    assert saved.serve1_outcome is ServeOutcome.IN
    assert saved.serve1_box is CourtSide.DEUCE
    assert saved.serve1_target is ServeTarget.T
    assert saved.serve1_fault_mode is None
    assert saved.serve2_outcome is None
    assert saved.return_outcome is None
    assert saved.end_reason is EndReason.FORCED
    assert saved.unusual_reason is None
    assert saved.note is None
    assert saved.wing is Wing.FOREHAND
    assert saved.shot_type is ShotType.DRIVE
    assert saved.ball_in is None
    assert saved.rally_length_bucket is None
    assert saved.set_number == 1
    assert saved.game_number == 1
    assert saved.in_tiebreak is False
    assert saved.is_match_point is False
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_point_round_trips_with_a_full_two_serve_opponent_serve_point(
    db_session: Session,
) -> None:
    """A first-serve fault followed by a second serve in, ending on a forced volley.
    Exercises the return, the shot, and the final ball location, none of which the
    minimal point above touches."""
    match = make_match(db_session)
    point = make_point(
        db_session,
        match_id=match.id,
        sequence=7,
        server=MatchSide.OPPONENT,
        won=True,
        serve1_outcome=ServeOutcome.FAULT,
        serve1_box=None,
        serve1_target=None,
        serve1_fault_mode=None,
        serve2_outcome=ServeOutcome.IN,
        return_outcome=ReturnOutcome.IN,
        end_reason=EndReason.FORCED,
        unusual_reason=None,
        note="Aggressive backhand volley to close it out",
        wing=Wing.BACKHAND,
        shot_type=ShotType.VOLLEY,
        ball_in=True,
        ball_half=CourtSide.AD,
        ball_depth=CourtDepth.SHORT,
        rally_length_bucket=RallyBucket.B3,
        set_number=2,
        game_number=5,
        in_tiebreak=False,
        is_break_point=False,
        is_game_point=True,
        is_game_end=True,
        is_set_point=False,
        is_set_end=False,
        is_match_point=False,
    )
    db_session.commit()

    saved = db_session.get(Point, point.id)
    assert saved is not None
    assert saved.sequence == 7
    assert saved.server is MatchSide.OPPONENT
    assert saved.serve1_outcome is ServeOutcome.FAULT
    # Location is null on an opponent serve regardless of outcome, placement there
    # being out of scope for capture.
    assert saved.serve1_box is None
    assert saved.serve1_target is None
    assert saved.serve2_outcome is ServeOutcome.IN
    assert saved.return_outcome is ReturnOutcome.IN
    assert saved.wing is Wing.BACKHAND
    assert saved.shot_type is ShotType.VOLLEY
    assert saved.ball_in is True
    assert saved.ball_half is CourtSide.AD
    assert saved.ball_depth is CourtDepth.SHORT
    assert saved.rally_length_bucket is RallyBucket.B3
    assert saved.set_number == 2
    assert saved.game_number == 5
    assert saved.is_game_point is True
    assert saved.is_game_end is True


def test_point_requires_an_existing_match(db_session: Session) -> None:
    """#107's ingest is the only writer, and this is the backstop behind it."""
    db_session.add(
        Point(
            match_id=uuid.uuid4(),
            sequence=0,
            server=MatchSide.TRACKED,
            won=True,
            serve1_outcome=ServeOutcome.IN,
            end_reason=EndReason.FORCED,
            set_number=1,
            game_number=1,
            in_tiebreak=False,
            is_break_point=False,
            is_game_point=False,
            is_game_end=False,
            is_set_point=False,
            is_set_end=False,
            is_match_point=False,
        )
    )

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_deleting_a_match_with_points_is_refused(db_session: Session) -> None:
    """No `ondelete` here, unlike `match_sets`: these rows are a coach's captured
    history, not a derived cache, so the delete is refused rather than cascaded."""
    point = make_point(db_session)
    match = db_session.get(Match, point.match_id)
    assert match is not None

    db_session.delete(match)
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_sequence_is_unique_within_a_match(db_session: Session) -> None:
    """Retried sync flushes are deduplicated on (match_id, sequence) (#107), so a
    second row for one point of one match must not be allowed to insert beside it."""
    first = make_point(db_session, sequence=0)

    with pytest.raises(IntegrityError):
        make_point(db_session, match_id=first.match_id, sequence=0)


def test_the_same_sequence_is_free_under_another_match(db_session: Session) -> None:
    """Sequence numbers are per-match ordinals, so every match has a point zero."""
    make_point(db_session, sequence=0)
    make_point(db_session, sequence=0)

    db_session.flush()


def test_match_id_leads_an_index(db_session: Session) -> None:
    """The foreign key declares no index of its own because the unique constraint's
    index leads on match_id, the same exception match_sets.match_id already is."""
    leading_columns = {
        index["column_names"][0] for index in inspect(db_session.connection()).get_indexes("points")
    }

    assert "match_id" in leading_columns


def test_nullable_columns_accept_null(db_session: Session) -> None:
    """Partial capture is accepted, so a point with only its required fields set has
    to round-trip too: the model test's version of the minimal shape above, pinned
    on the columns rather than on the scenario."""
    point = make_point(
        db_session,
        serve1_box=None,
        serve1_target=None,
        note=None,
        wing=None,
        shot_type=None,
        ball_in=None,
        rally_length_bucket=None,
    )
    db_session.commit()

    saved = db_session.get(Point, point.id)
    assert saved is not None
    assert saved.serve1_box is None
    assert saved.serve1_target is None
    assert saved.serve2_outcome is None
    assert saved.return_outcome is None
    assert saved.unusual_reason is None
    assert saved.note is None
    assert saved.wing is None
    assert saved.shot_type is None
    assert saved.ball_in is None
    assert saved.ball_half is None
    assert saved.ball_depth is None
    assert saved.ball_out_mode is None
    assert saved.rally_length_bucket is None


# The enum CHECK constraints and the paired-column CHECKs are deliberate choices
# argued in the model. Line coverage can't tell whether they still hold, since the
# class body executes on import either way, so they are pinned here, against writes
# that never pass through Pydantic or the ORM's own enum binding.


def _insert_raw_point(session: Session, **columns: object) -> None:
    """Insert a point through raw SQL, bypassing Pydantic and the ORM's enum binding.

    The constraints below are the database's job precisely because a sync payload
    can reach this table without either layer having vetted it. Unnamed columns take
    the minimal valid row below.
    """
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "match_id": make_match(session).id,
        "sequence": 0,
        "server": "tracked",
        "won": True,
        "serve1_outcome": "in",
        "serve1_box": None,
        "serve1_target": None,
        "serve1_fault_mode": None,
        "serve2_outcome": None,
        "serve2_box": None,
        "serve2_target": None,
        "serve2_fault_mode": None,
        "return_outcome": None,
        "end_reason": "forced",
        "unusual_reason": None,
        "note": None,
        "wing": None,
        "shot_type": None,
        "ball_in": None,
        "ball_half": None,
        "ball_depth": None,
        "ball_out_mode": None,
        "rally_length_bucket": None,
        "set_number": 1,
        "game_number": 1,
        "in_tiebreak": False,
        "is_break_point": False,
        "is_game_point": False,
        "is_game_end": False,
        "is_set_point": False,
        "is_set_end": False,
        "is_match_point": False,
        **columns,
    }
    columns_sql = ", ".join(defaults)
    params_sql = ", ".join(f":{name}" for name in defaults)
    session.execute(text(f"INSERT INTO points ({columns_sql}) VALUES ({params_sql})"), defaults)


@pytest.mark.parametrize(
    "half",
    [
        {"serve1_box": "deuce"},
        {"serve1_target": "t"},
        {"serve2_box": "ad"},
        {"serve2_target": "wide"},
        {"wing": "forehand"},
        {"shot_type": "drive"},
        {"ball_half": "deuce"},
        {"ball_depth": "mid"},
    ],
)
def test_database_rejects_a_half_set_pair(db_session: Session, half: dict[str, object]) -> None:
    """Each of the four pairs is one fact split over two columns: a serve zone with no
    target, a shot with no wing, a final ball half with no depth, name a location that
    is not really there."""
    with pytest.raises(IntegrityError):
        _insert_raw_point(db_session, **half)


def test_database_accepts_a_whole_serve1_zone(db_session: Session) -> None:
    """The other side of the CHECK: both halves of a pair together are accepted."""
    _insert_raw_point(db_session, serve1_box="ad", serve1_target="wide")


def test_database_rejects_end_reason_outside_the_enum(db_session: Session) -> None:
    """ "winner" is exactly the category the model deliberately has no member for:
    end_reason draws the line at reachability (FORCED/MISTAKE), not at a clean hit."""
    with pytest.raises(IntegrityError):
        _insert_raw_point(db_session, end_reason="winner")


# Every enum column, with whatever companion its paired CHECK insists on. Listed per
# column and not per enum because the migration spells the members out by hand once per
# column, and Alembic compares a CHECK by name and never by condition, so a value
# mistyped in the revision fails nothing but the test below.
ENUM_COLUMNS: list[tuple[str, type[enum.StrEnum], dict[str, str]]] = [
    ("server", MatchSide, {}),
    ("serve1_outcome", ServeOutcome, {}),
    ("serve1_box", CourtSide, {"serve1_target": "t"}),
    ("serve1_target", ServeTarget, {"serve1_box": "deuce"}),
    ("serve1_fault_mode", FailureMode, {}),
    ("serve2_outcome", ServeOutcome, {}),
    ("serve2_box", CourtSide, {"serve2_target": "t"}),
    ("serve2_target", ServeTarget, {"serve2_box": "deuce"}),
    ("serve2_fault_mode", FailureMode, {}),
    ("return_outcome", ReturnOutcome, {}),
    ("end_reason", EndReason, {}),
    ("unusual_reason", UnusualReason, {}),
    ("wing", Wing, {"shot_type": "drive"}),
    ("shot_type", ShotType, {"wing": "forehand"}),
    ("ball_half", CourtSide, {"ball_depth": "mid"}),
    ("ball_depth", CourtDepth, {"ball_half": "deuce"}),
    ("ball_out_mode", FailureMode, {}),
    ("rally_length_bucket", RallyBucket, {}),
]


@pytest.mark.parametrize(
    ("column", "member", "companions"),
    [
        pytest.param(column, member.value, companions, id=f"{column}-{member.value}")
        for column, members, companions in ENUM_COLUMNS
        for member in members
    ],
)
def test_database_accepts_every_enum_member(
    db_session: Session, column: str, member: str, companions: dict[str, str]
) -> None:
    _insert_raw_point(db_session, **{column: member}, **companions)


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now(): both commits below are
    savepoint releases inside the fixture's single outer transaction, so under
    now(), which is the transaction timestamp, a synced batch of points would share
    a creation time."""
    first = make_point(db_session, sequence=0)
    db_session.commit()

    second = make_point(db_session, match_id=first.match_id, sequence=1)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    """Points are append-only in practice, but the column follows the schema's
    standard pair regardless, so its onupdate is pinned like every other table's."""
    point = make_point(db_session)
    db_session.commit()
    first_written = point.updated_at

    point.note = "Corrected after review"
    db_session.commit()

    assert point.updated_at > first_written
