import uuid

import pytest
from psycopg.errors import CheckViolation, ForeignKeyViolation, UniqueViolation
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import Match, MatchSide, ScoreCheckpoint
from tests.factories import make_match, make_score_checkpoint, snapshot_set


def test_score_checkpoint_round_trips_its_snapshot(db_session: Session) -> None:
    match = make_match(db_session)
    after = {
        "sets": [
            snapshot_set(),
            snapshot_set(
                set_number=2,
                games_tracked=6,
                games_opponent=7,
                tiebreak_tracked=5,
                tiebreak_opponent=7,
                winner="opponent",
            ),
            snapshot_set(set_number=3, games_tracked=2, games_opponent=1, winner=None),
        ]
    }
    checkpoint = make_score_checkpoint(
        db_session,
        match_id=match.id,
        sequence=41,
        serves_next=MatchSide.TRACKED,
        order_changed=True,
        after=after,
    )
    db_session.commit()

    saved = db_session.get(ScoreCheckpoint, checkpoint.id)
    assert saved is not None
    assert saved.match_id == match.id
    assert saved.sequence == 41
    assert saved.serves_next is MatchSide.TRACKED
    assert saved.order_changed is True
    # JSONB stores the document, not its text, so what comes back is the same tree.
    assert saved.after == after
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_a_sequence_is_unique_within_a_match(db_session: Session) -> None:
    """Checkpoints share the match's sequence space with its points, and the ingest
    route turns this violation into the 409 the sync layer parks on."""
    first = make_score_checkpoint(db_session, sequence=3)

    with pytest.raises(IntegrityError) as caught:
        make_score_checkpoint(db_session, match_id=first.match_id, sequence=3)

    assert isinstance(caught.value.orig, UniqueViolation)


def test_the_same_sequence_in_another_match_is_fine(db_session: Session) -> None:
    first = make_score_checkpoint(db_session, sequence=3)
    second = make_score_checkpoint(db_session, sequence=3)

    assert first.match_id != second.match_id


def test_serves_next_is_constrained_to_the_sides(db_session: Session) -> None:
    """The CHECK behind `str_enum`, pinned because a JSON payload reaches this table
    without the ORM having vetted the value."""
    with pytest.raises(IntegrityError) as caught:
        make_score_checkpoint(db_session, serves_next="umpire")

    assert isinstance(caught.value.orig, CheckViolation)


def test_a_checkpoint_needs_an_existing_match(db_session: Session) -> None:
    with pytest.raises(IntegrityError) as caught:
        make_score_checkpoint(db_session, match_id=uuid.uuid4())

    assert isinstance(caught.value.orig, ForeignKeyViolation)


def test_a_match_with_checkpoints_refuses_to_be_deleted_underneath_them(
    db_session: Session,
) -> None:
    """No `ondelete`, as on points: the routes that delete a match erase these by hand,
    and this refusal is what stops a route left out of that list from orphaning rows."""
    checkpoint = make_score_checkpoint(db_session)
    match = db_session.get(Match, checkpoint.match_id)
    assert match is not None

    db_session.delete(match)

    with pytest.raises(IntegrityError) as caught:
        db_session.flush()

    assert isinstance(caught.value.orig, ForeignKeyViolation)


def test_match_id_leads_an_index(db_session: Session) -> None:
    """The foreign key declares no index of its own because the unique constraint's
    index leads on match_id, the exception points and match_sets already take."""
    leading_columns = {
        index["column_names"][0]
        for index in inspect(db_session.connection()).get_indexes("score_checkpoints")
    }

    assert "match_id" in leading_columns
