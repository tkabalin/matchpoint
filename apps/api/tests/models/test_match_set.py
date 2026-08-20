import uuid

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import Match, MatchSet, MatchSide
from tests.factories import make_match, make_match_set


def test_match_set_round_trips_with_match(db_session: Session) -> None:
    match = make_match(db_session)
    match_set = make_match_set(
        db_session,
        match_id=match.id,
        set_number=2,
        games_won_tracked=7,
        games_won_opponent=6,
        winner=MatchSide.TRACKED,
    )
    db_session.commit()

    saved = db_session.get(MatchSet, match_set.id)
    assert saved is not None
    assert saved.match_id == match.id
    assert saved.set_number == 2
    # A tiebreak set needs no column of its own: the breaker is another game, so 7-6 is
    # the tally the derivation arrives at without knowing what a tiebreak is.
    assert saved.games_won_tracked == 7
    assert saved.games_won_opponent == 6
    assert saved.winner is MatchSide.TRACKED
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_a_set_in_flight_has_a_tally_and_no_winner(db_session: Session) -> None:
    """The newest set of a match being captured is unfinished until a point stamped
    `is_set_end` arrives, so the tally has to stand on its own without a result."""
    match_set = make_match_set(db_session, games_won_tracked=3, games_won_opponent=2, winner=None)
    db_session.commit()

    saved = db_session.get(MatchSet, match_set.id)
    assert saved is not None
    assert saved.winner is None


def test_match_set_requires_an_existing_match(db_session: Session) -> None:
    """Nothing writes these rows but the ingest recompute, which reads the points of a
    match it has already loaded; the foreign key is the backstop behind that."""
    db_session.add(
        MatchSet(match_id=uuid.uuid4(), set_number=1, games_won_tracked=6, games_won_opponent=4)
    )

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_deleting_a_match_takes_its_derived_sets_with_it(db_session: Session) -> None:
    """The only `ondelete` in the schema, so it is worth pinning: everywhere else a child
    row refuses the delete, and here the row is derived and follows the match out."""
    match_set = make_match_set(db_session)
    match = db_session.get(Match, match_set.match_id)
    assert match is not None

    db_session.delete(match)
    db_session.flush()

    remaining = db_session.scalars(select(MatchSet).where(MatchSet.match_id == match.id)).all()
    assert remaining == []


def test_a_set_number_is_unique_within_a_match(db_session: Session) -> None:
    """Recomputation upserts on (match_id, set_number), so a second row for one set of
    one match would make it insert alongside the stale tally instead of replacing it."""
    first = make_match_set(db_session, set_number=1)

    db_session.add(
        MatchSet(match_id=first.match_id, set_number=1, games_won_tracked=6, games_won_opponent=1)
    )
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_the_same_set_number_is_free_under_another_match(db_session: Session) -> None:
    """Set numbers are per-match ordinals, so every match has a first set."""
    make_match_set(db_session, set_number=1)
    make_match_set(db_session, set_number=1)

    db_session.flush()


# The enum CHECK constraint, the timestamp defaults and the constraint's index are
# deliberate choices argued in the model. Line coverage can't tell whether they still
# hold, since the class body executes on import either way, so they are pinned here.


def _insert_raw_match_set(session: Session, **columns: object) -> None:
    """Insert a set row through raw SQL, bypassing the ORM's enum binding.

    Nothing but the server writes this table, so the CHECK guards a recompute holding a
    value the enum never had rather than a payload. Unnamed columns take the defaults.
    """
    session.execute(
        text(
            "INSERT INTO match_sets "
            "(id, match_id, set_number, games_won_tracked, games_won_opponent, winner) "
            "VALUES (:id, :match_id, :set_number, :games_won_tracked, "
            ":games_won_opponent, :winner)"
        ),
        {
            "id": uuid.uuid4(),
            "match_id": make_match(session).id,
            "set_number": 1,
            "games_won_tracked": 6,
            "games_won_opponent": 4,
            "winner": None,
            **columns,
        },
    )


def test_database_rejects_a_winner_outside_the_enum(db_session: Session) -> None:
    """Four characters on purpose: the column is VARCHAR(8), sized to "opponent", so a
    longer bogus value would fail on length before the CHECK was reached. It is also the
    answer tennis makes impossible, so the one a broken tally would most likely hold."""
    with pytest.raises(IntegrityError):
        _insert_raw_match_set(db_session, winner="both")


@pytest.mark.parametrize("member", [m.value for m in MatchSide])
def test_database_accepts_every_side(db_session: Session, member: str) -> None:
    """The migration spells the members out by hand, and nothing compares that list to
    the enum: Alembic checks a CHECK constraint by name and never by condition, so a
    value mistyped in the revision fails nothing but this."""
    _insert_raw_match_set(db_session, winner=member)


def test_match_id_leads_an_index(db_session: Session) -> None:
    """The foreign key declares no index of its own because the unique constraint's
    index leads on match_id. A constraint reordered to (set_number, match_id) would
    still be unique and would leave every lookup by match scanning the table."""
    leading_columns = {
        index["column_names"][0]
        for index in inspect(db_session.connection()).get_indexes("match_sets")
    }

    assert "match_id" in leading_columns


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now().

    Both commits below are savepoint releases inside the fixture's single outer
    transaction, so under now(), the transaction timestamp, the two rows would claim the
    same creation time: the one an ingest batch writing several sets would hit.
    """
    first = make_match_set(db_session, set_number=1)
    db_session.commit()

    second = make_match_set(db_session, match_id=first.match_id, set_number=2)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    """A recompute rewrites the tally of a set already stored, so the column has to move
    on an update rather than only on the insert."""
    match_set = make_match_set(db_session, games_won_tracked=5, winner=None)
    db_session.commit()
    first_written = match_set.updated_at

    match_set.games_won_tracked = 6
    match_set.winner = MatchSide.TRACKED
    db_session.commit()

    assert match_set.updated_at > first_written
