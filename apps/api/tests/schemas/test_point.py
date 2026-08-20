"""Unit tests for the PointCreate and PointBatch validation rules: no fixtures, no
database.

These rules are the server's one copy of the shape checks
`apps/web/src/features/capture/point.ts` runs before a point reaches the outbox, so the
cases below follow that contract's own: enum membership and which fields are set
together, never whether the tennis adds up. `tests/routers/test_matches.py` covers that
they are wired into the ingest route.
"""

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from matchpoint_api.models import (
    CourtDepth,
    CourtSide,
    EndReason,
    FailureMode,
    MatchSide,
    RallyBucket,
    ReturnOutcome,
    ServeOutcome,
    ServeTarget,
    ShotType,
    UnusualReason,
    Wing,
)
from matchpoint_api.schemas.point import (
    MAX_BATCH_POINTS,
    MAX_COUNTER,
    PointBatch,
    PointCreate,
)
from tests.factories import point_payload

# A first serve faulted and the second one landing, which is the only way a point
# carries two serve attempts.
SECOND_SERVE: dict[str, Any] = {
    "serve1_outcome": "fault",
    "serve1_box": None,
    "serve1_target": None,
    "serve1_fault_mode": "long",
    "serve2_outcome": "in",
    "serve2_box": "ad",
    "serve2_target": "wide",
}

# The opponent serving: no placement is captured on any of their attempts.
OPPONENT_SERVE: dict[str, Any] = {
    "server": "opponent",
    "serve1_box": None,
    "serve1_target": None,
}

# Nothing was struck, so neither the last shot nor the final ball is recorded.
NO_CONTACT: dict[str, Any] = {
    "wing": None,
    "shot_type": None,
    "ball_in": None,
    "ball_half": None,
    "ball_depth": None,
}


def _point(**overrides: Any) -> PointCreate:
    return PointCreate.model_validate(point_payload(**overrides))


def test_the_default_shape_round_trips() -> None:
    point = _point()

    assert point.server is MatchSide.TRACKED
    assert point.serve1_outcome is ServeOutcome.IN
    assert point.serve1_box is CourtSide.DEUCE
    assert point.serve1_target is ServeTarget.T
    assert point.serve1_fault_mode is None
    assert point.serve2_outcome is None
    assert point.return_outcome is None
    assert point.end_reason is EndReason.FORCED
    assert point.unusual_reason is None
    assert point.note is None
    assert point.wing is Wing.FOREHAND
    assert point.shot_type is ShotType.DRIVE
    assert point.ball_in is True
    assert point.ball_half is CourtSide.AD
    assert point.ball_depth is CourtDepth.DEEP
    assert point.ball_out_mode is None
    assert point.rally_length_bucket is None
    assert point.sequence == 0
    assert point.set_number == 1


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(SECOND_SERVE, id="second serve after a first-serve fault"),
        pytest.param(
            SECOND_SERVE
            | {"serve2_outcome": "fault", "serve2_box": None, "serve2_target": None}
            | {"serve2_fault_mode": "net", "end_reason": "double_fault", "won": False}
            | NO_CONTACT,
            id="double fault",
        ),
        pytest.param(
            {"serve1_outcome": "ace", "end_reason": "ace"} | NO_CONTACT,
            id="ace",
        ),
        pytest.param(OPPONENT_SERVE | {"return_outcome": "in"}, id="opponent serve returned in"),
        pytest.param(
            OPPONENT_SERVE | {"return_outcome": "net", "won": False} | NO_CONTACT,
            id="opponent serve missed on the return",
        ),
        pytest.param(OPPONENT_SERVE, id="opponent serve with no return recorded"),
        pytest.param(
            {"end_reason": "unusual", "unusual_reason": "hindrance"} | NO_CONTACT,
            id="unusual ending",
        ),
        pytest.param({"end_reason": "unusual"} | NO_CONTACT, id="unusual with no reason given"),
        # The note is a general coach annotation (#175), not the unusual-point field the
        # TS contract still restricts it to.
        pytest.param({"note": "Rushed the second serve again."}, id="note on an ordinary point"),
        pytest.param({"wing": None, "shot_type": None}, id="a struck ball with no shot recorded"),
        pytest.param(
            {"ball_in": False, "ball_half": None, "ball_depth": None, "ball_out_mode": "wide"},
            id="final ball out",
        ),
        pytest.param({"rally_length_bucket": "b4"}, id="rally bucket"),
        pytest.param({"sequence": 0, "set_number": 5, "game_number": 13}, id="bounds at the floor"),
        pytest.param(
            {"sequence": MAX_COUNTER, "set_number": MAX_COUNTER, "game_number": MAX_COUNTER},
            id="counters at the ceiling",
        ),
        pytest.param(
            {"in_tiebreak": True, "is_game_end": True, "is_set_end": True, "is_match_point": True},
            id="stamps set",
        ),
    ],
)
def test_shapes_the_contract_allows(overrides: dict[str, Any]) -> None:
    assert _point(**overrides) is not None


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"serve2_outcome": "in"}, id="a second serve after a first serve that landed"),
        pytest.param(
            {"serve1_outcome": "fault", "serve1_box": None, "serve1_target": None}
            | {"serve1_fault_mode": "net", "end_reason": "double_fault"},
            id="a faulted first serve with no second attempt",
        ),
        pytest.param({"serve1_box": None}, id="a landed serve missing its box"),
        pytest.param({"serve1_target": None}, id="a landed serve missing its target"),
        pytest.param(
            SECOND_SERVE | {"serve1_box": "deuce", "serve1_target": "t"},
            id="a faulted serve keeping its box and target",
        ),
        pytest.param(
            SECOND_SERVE | {"serve1_fault_mode": None},
            id="a faulted serve with no fault mode",
        ),
        pytest.param(OPPONENT_SERVE | {"serve1_box": "deuce"}, id="placement on an opponent serve"),
        pytest.param(
            OPPONENT_SERVE | {"serve1_fault_mode": "net"},
            id="a fault mode on an opponent serve",
        ),
        pytest.param(
            SECOND_SERVE | {"serve2_fault_mode": "net"},
            id="a landed second serve carrying a fault mode",
        ),
        pytest.param({"serve2_box": "ad"}, id="a location on a second serve that never happened"),
        pytest.param(
            SECOND_SERVE
            | {"serve2_outcome": "fault", "serve2_box": None, "serve2_target": None}
            | {"serve2_fault_mode": "net"}
            | NO_CONTACT,
            id="both serves faulted without the double-fault ending",
        ),
        pytest.param(
            {"end_reason": "double_fault"} | NO_CONTACT,
            id="the double-fault ending without both serves faulted",
        ),
        pytest.param({"return_outcome": "in"}, id="a return on the tracked player's own serve"),
        pytest.param({"unusual_reason": "net_touch"}, id="an unusual reason on an ordinary point"),
        pytest.param(
            {"end_reason": "ace", "serve1_outcome": "ace"},
            id="an ace carrying a last shot",
        ),
        pytest.param(
            OPPONENT_SERVE | {"return_outcome": "long", "won": False},
            id="a missed return carrying a last shot",
        ),
        pytest.param({"shot_type": None}, id="a wing with no shot type"),
        pytest.param({"wing": None}, id="a shot type with no wing"),
        pytest.param({"ball_in": None, "ball_half": None, "ball_depth": None}, id="no ball_in"),
        pytest.param({"ball_depth": None}, id="a ball in with no depth"),
        pytest.param({"ball_half": None}, id="a ball in with no half"),
        pytest.param({"ball_out_mode": "net"}, id="a ball in carrying an out mode"),
        pytest.param(
            {"ball_in": False, "ball_half": None, "ball_depth": None},
            id="a ball out with no out mode",
        ),
        pytest.param(
            {"ball_in": False, "ball_depth": None, "ball_out_mode": "net"},
            id="a ball out keeping its half",
        ),
        pytest.param({"sequence": -1}, id="a negative sequence"),
        pytest.param({"set_number": 0}, id="a set number below one"),
        pytest.param({"game_number": 0}, id="a game number below one"),
        # Past the column's own ceiling, where Postgres raises a DataError the ingest
        # route does not catch, so the 422 here is what keeps it off a 500 the sync
        # layer would retry for ever.
        pytest.param({"sequence": MAX_COUNTER + 1}, id="a sequence past the column"),
        pytest.param({"set_number": MAX_COUNTER + 1}, id="a set number past the column"),
        pytest.param({"game_number": MAX_COUNTER + 1}, id="a game number past the column"),
        pytest.param({"note": ""}, id="an empty note"),
        pytest.param({"server": "either"}, id="a server outside the enum"),
        pytest.param({"end_reason": "winner"}, id="an end reason outside the enum"),
        pytest.param({"match_id": str(uuid.uuid4())}, id="a body naming its own match"),
        pytest.param({"timestamp": 1_760_000_000}, id="an unknown field"),
    ],
)
def test_shapes_the_contract_refuses(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        _point(**overrides)


@pytest.mark.parametrize("field", ["sequence", "server", "won", "serve1_outcome", "end_reason"])
def test_a_missing_required_field_is_refused(field: str) -> None:
    payload = point_payload()
    del payload[field]

    with pytest.raises(ValidationError):
        PointCreate.model_validate(payload)


@pytest.mark.parametrize(
    "stamp",
    [
        "in_tiebreak",
        "is_break_point",
        "is_game_point",
        "is_game_end",
        "is_set_point",
        "is_set_end",
        "is_match_point",
    ],
)
def test_every_stamp_is_required(stamp: str) -> None:
    """A stamp the client left out is a client bug. Defaulting it to false would store
    that bug as a fact about the point, and the scoring engine fills all nine."""
    payload = point_payload()
    del payload[stamp]

    with pytest.raises(ValidationError):
        PointCreate.model_validate(payload)


def test_the_note_is_stripped_and_bounded() -> None:
    assert _point(note="  spaced  ").note == "spaced"

    with pytest.raises(ValidationError):
        _point(note="x" * 2001)


def test_the_full_enum_membership_reaches_the_columns() -> None:
    """One point using a value from every enum the model declares, so a field wired to
    the wrong one shows up here rather than as a CHECK violation at ingest."""
    point = _point(
        **OPPONENT_SERVE,
        return_outcome="wide",
        won=False,
        end_reason="unusual",
        unusual_reason="point_penalty",
        rally_length_bucket="b2",
        **NO_CONTACT,
    )

    assert point.server is MatchSide.OPPONENT
    assert point.return_outcome is ReturnOutcome.WIDE
    assert point.unusual_reason is UnusualReason.POINT_PENALTY
    assert point.rally_length_bucket is RallyBucket.B2
    assert _point(ball_in=False, ball_half=None, ball_depth=None, ball_out_mode="net").ball_out_mode
    assert _point(**SECOND_SERVE).serve1_fault_mode is FailureMode.LONG


def _batch(**overrides: Any) -> PointBatch:
    return PointBatch.model_validate(
        {"device_id": str(uuid.uuid4()), "points": [point_payload()]} | overrides
    )


def test_a_batch_carries_a_device_and_its_points() -> None:
    batch = _batch()

    assert isinstance(batch.device_id, uuid.UUID)
    assert len(batch.points) == 1


def test_a_batch_without_a_device_is_refused() -> None:
    with pytest.raises(ValidationError):
        PointBatch.model_validate({"points": [point_payload()]})


def test_an_empty_batch_is_refused() -> None:
    """Nothing to ingest is the drain calling with nothing to say, and answering it
    with a success would hide that."""
    with pytest.raises(ValidationError):
        _batch(points=[])


def test_a_batch_at_the_ceiling_is_accepted() -> None:
    points = [point_payload(sequence=index) for index in range(MAX_BATCH_POINTS)]

    assert len(_batch(points=points).points) == MAX_BATCH_POINTS


def test_a_batch_over_the_ceiling_is_refused() -> None:
    points = [point_payload(sequence=index) for index in range(MAX_BATCH_POINTS + 1)]

    with pytest.raises(ValidationError):
        _batch(points=points)


def test_a_batch_cannot_repeat_a_point_id() -> None:
    """Across flushes a repeat is deduplicated on the stored id; inside one it is a
    caller bug, and naming it beats leaving the outcome to Postgres."""
    point = point_payload()

    with pytest.raises(ValidationError):
        _batch(points=[point, point | {"sequence": 1}])


def test_a_batch_cannot_repeat_a_sequence() -> None:
    with pytest.raises(ValidationError):
        _batch(points=[point_payload(), point_payload()])
