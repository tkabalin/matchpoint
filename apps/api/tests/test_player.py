import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import DominantHand, Gender, Player

NAME_FIELDS = ["first_name", "last_name"]


def _player_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Player)) or 0


def test_player_round_trips(db_session: Session) -> None:
    player = Player(
        first_name="Serena",
        last_name="Williams",
        dominant_hand=DominantHand.RIGHT,
        gender=Gender.FEMALE,
        notes="Second serve sits up under pressure.",
    )
    db_session.add(player)
    db_session.commit()

    saved = db_session.get(Player, player.id)
    assert saved is not None
    assert saved.first_name == "Serena"
    assert saved.last_name == "Williams"
    assert saved.dominant_hand is DominantHand.RIGHT
    assert saved.gender is Gender.FEMALE
    assert saved.notes == "Second serve sits up under pressure."
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# Each of this pair would see the other's committed row if the db_session rollback
# leaked state; together they prove per-test isolation regardless of execution order.
def test_committed_rows_do_not_leak_between_tests_a(db_session: Session) -> None:
    assert _player_count(db_session) == 0
    db_session.add(Player(first_name="Iga", last_name="Swiatek"))
    db_session.commit()
    assert _player_count(db_session) == 1


def test_committed_rows_do_not_leak_between_tests_b(db_session: Session) -> None:
    assert _player_count(db_session) == 0
    db_session.add(Player(first_name="Carlos", last_name="Alcaraz"))
    db_session.commit()
    assert _player_count(db_session) == 1


def test_only_the_name_parts_are_required(db_session: Session) -> None:
    """Profile setup has to be fast, so every column past the name is nullable.

    That includes coach_id and archived_at, which no endpoint writes yet: were either
    NOT NULL, this insert would be the thing that failed rather than the first request.
    """
    player = Player(first_name="Iga", last_name="Swiatek")
    db_session.add(player)
    db_session.commit()

    assert player.date_of_birth is None
    assert player.dominant_hand is None
    assert player.gender is None
    assert player.notes is None
    assert player.coach_id is None
    assert player.archived_at is None


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now().

    Both commits below are savepoint releases inside the fixture's single outer
    transaction, so under now() — the transaction timestamp — the two rows would
    claim the same creation time.
    """
    first = Player(first_name="Iga", last_name="Swiatek")
    db_session.add(first)
    db_session.commit()

    second = Player(first_name="Carlos", last_name="Alcaraz")
    db_session.add(second)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    player = Player(first_name="Serena", last_name="Williams")
    db_session.add(player)
    db_session.commit()
    first_written = player.updated_at

    player.last_name = "Williams-Ohanian"
    db_session.commit()

    assert player.updated_at > first_written


# The nullability, the column widths and the enum CHECK constraints are deliberate
# choices argued in the model. Line coverage can't tell whether they still hold — the
# class body executes on import either way — so they are pinned here, against writes
# that never pass through Pydantic or the ORM.


def _insert_raw_player(session: Session, **columns: object) -> None:
    """Insert a player through raw SQL, bypassing Pydantic and the ORM's enum binding.

    The constraints below are the database's job precisely because a sync payload can
    reach the table without either of those layers having vetted it. Unnamed columns
    are written as NULL.
    """
    session.execute(
        text(
            "INSERT INTO players (id, first_name, last_name, dominant_hand, gender) "
            "VALUES (:id, :first_name, :last_name, :dominant_hand, :gender)"
        ),
        {
            "id": uuid.uuid4(),
            "first_name": "Rafa",
            "last_name": "Nadal",
            "dominant_hand": None,
            "gender": None,
            **columns,
        },
    )


@pytest.mark.parametrize("field", NAME_FIELDS)
def test_database_requires_both_name_parts(db_session: Session, field: str) -> None:
    """A first name alone is not a player, nor a surname alone. The NOT NULL comes from
    the model's bare `Mapped[str]`, so an accidental `| None` would widen it silently."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, **{field: None})


def test_database_rejects_dominant_hand_outside_the_enum(db_session: Session) -> None:
    """Four characters on purpose: the column is VARCHAR(5), sized to "right", so a
    longer bogus value fails on length before the CHECK is reached and would prove
    nothing about the constraint."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, dominant_hand="both")


def test_database_rejects_gender_outside_the_enum(db_session: Session) -> None:
    """Same constraint shape, and the same length trap: gender is VARCHAR(6), sized to
    "female", so the probe has to be short enough to reach the CHECK on the way."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, gender="nb")


@pytest.mark.parametrize("field", NAME_FIELDS)
def test_database_rejects_a_name_over_the_column_width(db_session: Session, field: str) -> None:
    """ShortText's 100-character bound claims to match the String(100) columns.
    Nothing checks the other half of that pairing, so a column narrowed to String(50)
    would first surface as a 500 in production."""
    with pytest.raises(DataError):
        _insert_raw_player(db_session, **{field: "x" * 101})
