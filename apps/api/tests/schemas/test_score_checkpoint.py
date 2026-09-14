"""Unit tests for the checkpoint validation rules: no fixtures, no database.

Structural only, as the point rules are: which fields go together and how the sets
are numbered, never whether the declared games can close a set under the match's
scoring system. `tests/routers/test_matches.py` covers that they are wired into the
ingest route.
"""

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from matchpoint_api.models import MatchSide
from matchpoint_api.schemas.point import MAX_BATCH_POINTS, MAX_COUNTER
from matchpoint_api.schemas.score_checkpoint import (
    MAX_GAMES,
    MAX_SNAPSHOT_SETS,
    ScoreCheckpointBatch,
    ScoreCheckpointCreate,
    ScoreCheckpointRead,
    ScoreSnapshot,
)
from tests.factories import checkpoint_payload, snapshot_set


def _batch(*checkpoints: dict[str, Any]) -> dict[str, Any]:
    return {"device_id": str(uuid.uuid4()), "checkpoints": list(checkpoints)}


def test_a_full_checkpoint_validates_and_keeps_its_enums() -> None:
    payload = checkpoint_payload(
        sequence=12,
        serves_next="tracked",
        order_changed=True,
        after={
            "sets": [
                snapshot_set(),
                snapshot_set(
                    set_number=2,
                    games_tracked=7,
                    games_opponent=6,
                    tiebreak_tracked=7,
                    tiebreak_opponent=3,
                ),
                snapshot_set(set_number=3, games_tracked=0, games_opponent=0, winner=None),
            ]
        },
    )

    checkpoint = ScoreCheckpointCreate.model_validate(payload)

    assert checkpoint.serves_next is MatchSide.TRACKED
    assert checkpoint.after.sets[1].winner is MatchSide.TRACKED
    assert checkpoint.after.sets[1].tiebreak_opponent == 3
    assert checkpoint.after.sets[2].winner is None
    # What the route stores, and what the read schema hands back, is the wire form.
    assert checkpoint.model_dump(mode="json") == payload


def test_the_tiebreak_fields_are_paired() -> None:
    with pytest.raises(ValidationError, match="both sides or neither"):
        ScoreSnapshot.model_validate({"sets": [snapshot_set(tiebreak_tracked=7)]})


@pytest.mark.parametrize(
    "numbers",
    [[2], [1, 3], [2, 1], [1, 1]],
    ids=["starts at two", "skips a set", "out of order", "repeats a set"],
)
def test_sets_are_numbered_from_one_in_order(numbers: list[int]) -> None:
    sets = [snapshot_set(set_number=number) for number in numbers]

    with pytest.raises(ValidationError, match="numbered from 1"):
        ScoreSnapshot.model_validate({"sets": sets})


def test_a_snapshot_needs_at_least_one_set() -> None:
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": []})


def test_a_board_holds_at_most_the_sets_a_match_can_play() -> None:
    """Every entry becomes a `match_sets` row rewritten at each later flush, so the list
    is capped where the formats the client scores cap it."""
    sets = [snapshot_set(set_number=n) for n in range(1, MAX_SNAPSHOT_SETS + 2)]

    ScoreSnapshot.model_validate({"sets": sets[:-1]})
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": sets})


@pytest.mark.parametrize(
    "field", ["games_tracked", "games_opponent", "tiebreak_tracked", "tiebreak_opponent"]
)
def test_a_count_cannot_be_negative(field: str) -> None:
    entry = snapshot_set(tiebreak_tracked=0, tiebreak_opponent=0) | {field: -1}

    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": [entry]})


def test_a_count_is_bounded_by_the_integer_column() -> None:
    """Past the column's ceiling the insert is a DataError, not the IntegrityError the
    route catches, so the bound has to be here. A declared game count stops well short
    of it: the fold adds the tail's games before the sum reaches the column."""
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": [snapshot_set(games_tracked=MAX_GAMES + 1)]})
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": [snapshot_set(games_opponent=MAX_GAMES + 1)]})
    with pytest.raises(ValidationError):
        ScoreCheckpointCreate.model_validate(checkpoint_payload(sequence=MAX_COUNTER + 1))


def test_a_winner_must_be_a_side() -> None:
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": [snapshot_set(winner="umpire")]})


def test_a_sequence_cannot_be_negative() -> None:
    with pytest.raises(ValidationError):
        ScoreCheckpointCreate.model_validate(checkpoint_payload(sequence=-1))


@pytest.mark.parametrize("field", ["id", "sequence", "serves_next", "order_changed", "after"])
def test_every_field_is_required(field: str) -> None:
    payload = checkpoint_payload()
    del payload[field]

    with pytest.raises(ValidationError):
        ScoreCheckpointCreate.model_validate(payload)


def test_an_unknown_field_is_refused() -> None:
    """The client's own stored form carries `timestamp` and `matchId`; the mapper drops
    them, and a batch that forgot to would be told rather than quietly trimmed."""
    with pytest.raises(ValidationError):
        ScoreCheckpointCreate.model_validate(checkpoint_payload(timestamp=1_700_000_000))
    with pytest.raises(ValidationError):
        ScoreSnapshot.model_validate({"sets": [snapshot_set()], "game": None})


def test_a_batch_cannot_repeat_an_id() -> None:
    payload = checkpoint_payload()

    with pytest.raises(ValidationError, match="same checkpoint id twice"):
        ScoreCheckpointBatch.model_validate(_batch(payload, payload | {"sequence": 1}))


def test_a_batch_cannot_repeat_a_sequence() -> None:
    with pytest.raises(ValidationError, match="same sequence twice"):
        ScoreCheckpointBatch.model_validate(
            _batch(checkpoint_payload(sequence=4), checkpoint_payload(sequence=4))
        )


def test_a_batch_is_bounded_like_a_point_batch() -> None:
    too_many = [checkpoint_payload(sequence=n) for n in range(MAX_BATCH_POINTS + 1)]

    with pytest.raises(ValidationError):
        ScoreCheckpointBatch.model_validate(_batch(*too_many))
    with pytest.raises(ValidationError):
        ScoreCheckpointBatch.model_validate(_batch())


def test_the_read_schema_parses_the_stored_document() -> None:
    """The row holds `after` as a plain dict, and the read schema types it back into
    the snapshot so the spec, and the generated client, carry the shape."""
    read = ScoreCheckpointRead.model_validate(
        {
            "id": uuid.uuid4(),
            "match_id": uuid.uuid4(),
            "sequence": 0,
            "serves_next": "opponent",
            "order_changed": False,
            "after": {"sets": [snapshot_set()]},
        }
    )

    assert read.after.sets[0].winner is MatchSide.TRACKED
