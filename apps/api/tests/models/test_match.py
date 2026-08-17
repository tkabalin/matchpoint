import uuid
from datetime import date

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import Match, MatchResult, Player, ScoringSystem, Surface
from tests.factories import make_match, make_player


def test_match_round_trips_with_player(db_session: Session) -> None:
    player = make_player(db_session, first_name="Iga", last_name="Swiatek")
    match = make_match(
        db_session,
        player_id=player.id,
        opponent_name="Aryna",
        played_on=date(2026, 8, 1),
        surface=Surface.CLAY,
        event="Roland-Garros",
        scoring_system=ScoringSystem.TRADITIONAL,
        result=MatchResult.WIN,
    )
    db_session.commit()

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.player_id == player.id
    assert saved.opponent_name == "Aryna"
    assert saved.played_on == date(2026, 8, 1)
    assert saved.surface is Surface.CLAY
    assert saved.event == "Roland-Garros"
    assert saved.scoring_system is ScoringSystem.TRADITIONAL
    assert saved.result is MatchResult.WIN
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_only_the_player_and_date_are_required(db_session: Session) -> None:
    """Match setup has to stay fast, so everything describing the match itself is
    optional — the nullability is the feature, not an oversight."""
    match = make_match(db_session)
    db_session.commit()

    saved = db_session.get(Match, match.id)
    assert saved is not None
    assert saved.opponent_name is None
    assert saved.surface is None
    assert saved.event is None
    assert saved.scoring_system is None
    assert saved.result is None


def test_match_requires_a_played_on_date(db_session: Session) -> None:
    player = make_player(db_session)
    db_session.add(Match(player_id=player.id))

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_match_requires_an_existing_player(db_session: Session) -> None:
    """The foreign key is the backstop behind the router's own check."""
    db_session.add(Match(player_id=uuid.uuid4(), played_on=date(2026, 8, 1)))

    with pytest.raises(IntegrityError):
        db_session.flush()


def test_a_player_with_matches_cannot_be_deleted(db_session: Session) -> None:
    """The foreign key declares no ON DELETE, so Postgres refuses the delete rather
    than cascading it into the match history or orphaning the row."""
    match = make_match(db_session)
    player = db_session.get(Player, match.player_id)
    assert player is not None

    db_session.delete(player)
    with pytest.raises(IntegrityError):
        db_session.flush()


# The enum CHECK constraints, the column widths and the timestamp defaults are
# deliberate choices argued in the model. Line coverage can't tell whether they
# still hold — the class body executes on import either way — so they are pinned
# here, against writes that never pass through Pydantic or the ORM.


def _insert_raw_match(session: Session, **columns: object) -> None:
    """Insert a match through raw SQL, bypassing Pydantic and the ORM's enum binding.

    The constraints below are the database's job precisely because a sync payload can
    reach the table without either of those layers having vetted it. Unnamed columns
    are written as NULL.
    """
    session.execute(
        text(
            "INSERT INTO matches "
            "(id, player_id, played_on, opponent_name, surface, scoring_system, result) "
            "VALUES (:id, :player_id, :played_on, :opponent_name, :surface, "
            ":scoring_system, :result)"
        ),
        {
            "id": uuid.uuid4(),
            "player_id": make_player(session).id,
            "played_on": date(2026, 8, 1),
            "opponent_name": None,
            "surface": None,
            "scoring_system": None,
            "result": None,
            **columns,
        },
    )


def test_database_rejects_surface_outside_the_enum(db_session: Session) -> None:
    """Four characters on purpose: the column is VARCHAR(6), sized to "carpet", so a
    longer bogus value fails on length before the CHECK is reached and would prove
    nothing about the constraint."""
    with pytest.raises(IntegrityError):
        _insert_raw_match(db_session, surface="sand")


def test_database_rejects_scoring_system_outside_the_enum(db_session: Session) -> None:
    """A "best_of_3" fits the column's VARCHAR(24), so it reaches the CHECK rather than
    the width limit, and a client still sending the set counts this column replaced is
    exactly the payload it now has to refuse."""
    with pytest.raises(IntegrityError):
        _insert_raw_match(db_session, scoring_system="best_of_3")


@pytest.mark.parametrize("member", [m.value for m in ScoringSystem])
def test_database_accepts_every_scoring_system(db_session: Session, member: str) -> None:
    """The migration spells the eight members out by hand, and nothing compares that
    list to the enum: Alembic checks a CHECK constraint by name and never by condition,
    so a value mistyped in the revision fails nothing but this."""
    _insert_raw_match(db_session, scoring_system=member)


def test_database_rejects_result_outside_the_enum(db_session: Session) -> None:
    """A "draw" is exactly the column's VARCHAR(4), sized to "loss", so it reaches the
    CHECK rather than the width limit. It is also the value tennis makes impossible, so
    the one a bad payload would most plausibly carry."""
    with pytest.raises(IntegrityError):
        _insert_raw_match(db_session, result="draw")


def test_database_rejects_free_text_over_the_column_width(db_session: Session) -> None:
    """ShortText's 100-character bound claims to match the String(100) columns.
    Nothing checks the other half of that pairing, so a column narrowed to String(50)
    would first surface as a 500 in production."""
    with pytest.raises(DataError):
        _insert_raw_match(db_session, opponent_name="x" * 101)


def test_player_id_is_indexed(db_session: Session) -> None:
    """Every analytics query filters matches by player, which is the whole reason
    the column carries an index — a migration that dropped it would otherwise show
    up as nothing but a slow dashboard."""
    indexed_columns = {
        tuple(index["column_names"])
        for index in inspect(db_session.connection()).get_indexes("matches")
    }

    assert ("player_id",) in indexed_columns


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now().

    Both commits below are savepoint releases inside the fixture's single outer
    transaction, so under now() — the transaction timestamp — the two rows would
    claim the same creation time, and list_matches' same-day tiebreaker would
    order them arbitrarily.
    """
    first = make_match(db_session)
    db_session.commit()

    second = make_match(db_session)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    match = make_match(db_session)
    db_session.commit()
    first_written = match.updated_at

    match.opponent_name = "Aryna"
    db_session.commit()

    assert match.updated_at > first_written
