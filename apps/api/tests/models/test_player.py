import uuid

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import DominantHand, Gender, Player
from tests.factories import make_coach, make_player, make_player_transfer_code

NAME_FIELDS = ["first_name", "last_name"]


def _player_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Player)) or 0


def test_player_round_trips(db_session: Session) -> None:
    coach = make_coach(db_session)
    player = Player(
        first_name="Serena",
        last_name="Williams",
        username="wllser001",
        dominant_hand=DominantHand.RIGHT,
        gender=Gender.FEMALE,
        notes="Second serve sits up under pressure.",
        coach_id=coach.id,
    )
    db_session.add(player)
    db_session.commit()

    saved = db_session.get(Player, player.id)
    assert saved is not None
    assert saved.first_name == "Serena"
    assert saved.last_name == "Williams"
    assert saved.username == "wllser001"
    assert saved.dominant_hand is DominantHand.RIGHT
    assert saved.gender is Gender.FEMALE
    assert saved.notes == "Second serve sits up under pressure."
    assert saved.coach_id == coach.id
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# Each of this pair would see the other's committed row if the db_session rollback
# leaked state; together they prove per-test isolation regardless of execution order.
def test_committed_rows_do_not_leak_between_tests_a(db_session: Session) -> None:
    assert _player_count(db_session) == 0
    db_session.add(
        Player(
            first_name="Iga",
            last_name="Swiatek",
            username="swtiga001",
            coach_id=make_coach(db_session).id,
        )
    )
    db_session.commit()
    assert _player_count(db_session) == 1


def test_committed_rows_do_not_leak_between_tests_b(db_session: Session) -> None:
    assert _player_count(db_session) == 0
    db_session.add(
        Player(
            first_name="Carlos",
            last_name="Alcaraz",
            username="alccar001",
            coach_id=make_coach(db_session).id,
        )
    )
    db_session.commit()
    assert _player_count(db_session) == 1


def test_only_the_name_parts_and_the_owner_are_required(db_session: Session) -> None:
    """Profile setup has to be fast, so every column a coach could type is nullable
    past the two name parts. coach_id is required too, but costs nothing at the
    keyboard — the route fills it from the session, never from the form."""
    player = Player(
        first_name="Iga",
        last_name="Swiatek",
        username="swtiga001",
        coach_id=make_coach(db_session).id,
    )
    db_session.add(player)
    db_session.commit()

    assert player.date_of_birth is None
    assert player.dominant_hand is None
    assert player.gender is None
    assert player.notes is None


def test_created_at_differs_between_rows_in_one_transaction(db_session: Session) -> None:
    """created_at defaults to clock_timestamp(), not now().

    Both commits below are savepoint releases inside the fixture's single outer
    transaction, so under now() — the transaction timestamp — the two rows would
    claim the same creation time.
    """
    coach = make_coach(db_session)
    first = Player(first_name="Iga", last_name="Swiatek", username="swtiga001", coach_id=coach.id)
    db_session.add(first)
    db_session.commit()

    second = Player(
        first_name="Carlos", last_name="Alcaraz", username="alccar001", coach_id=coach.id
    )
    db_session.add(second)
    db_session.commit()

    assert second.created_at > first.created_at


def test_updated_at_advances_when_a_row_changes(db_session: Session) -> None:
    player = Player(
        first_name="Serena",
        last_name="Williams",
        username="wllser001",
        coach_id=make_coach(db_session).id,
    )
    db_session.add(player)
    db_session.commit()
    first_written = player.updated_at

    player.last_name = "Williams-Ohanian"
    db_session.commit()

    assert player.updated_at > first_written


def test_has_transfer_code_follows_the_code_row(db_session: Session) -> None:
    """Derived rather than stored, so no write has to remember to keep it in step.

    The mint, the cancel and the redeem each only touch player_transfer_codes, and the
    attribute is an EXISTS over that table read alongside the player.
    """
    player = make_player(db_session)
    db_session.commit()
    assert player.has_transfer_code is False

    code = make_player_transfer_code(db_session, player_id=player.id)
    db_session.commit()
    db_session.expire(player)
    assert player.has_transfer_code is True

    db_session.delete(code)
    db_session.commit()
    db_session.expire(player)
    assert player.has_transfer_code is False


def test_has_transfer_code_answers_for_one_player_at_a_time(db_session: Session) -> None:
    """The EXISTS correlates on the player's own id, which a roster of two proves and a
    roster of one cannot: one code must not light up every row beside it."""
    coach = make_coach(db_session)
    holder = make_player(db_session, coach_id=coach.id)
    other = make_player(db_session, coach_id=coach.id)
    make_player_transfer_code(db_session, player_id=holder.id)
    db_session.commit()

    flags = {p.id: p.has_transfer_code for p in db_session.scalars(select(Player))}

    assert flags == {holder.id: True, other.id: False}


# The nullability, the column widths and the enum CHECK constraints are deliberate
# choices argued in the model. Line coverage can't tell whether they still hold — the
# class body executes on import either way — so they are pinned here, against writes
# that never pass through Pydantic or the ORM.


def _insert_raw_player(session: Session, **columns: object) -> None:
    """Insert a player through raw SQL, bypassing Pydantic and the ORM's enum binding.

    The constraints below are the database's job precisely because a sync payload can
    reach the table without either of those layers having vetted it. Unnamed columns
    are written as NULL — except coach_id, which defaults to a real coach because the
    column is NOT NULL and most of these tests are about the other constraints.
    """
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "first_name": "Rafa",
        "last_name": "Nadal",
        # Unique per call like the factory's, since most of these tests are about
        # the other constraints.
        "username": f"ndlraf{uuid.uuid4().int % 1_000_000_000:09d}",
        "dominant_hand": None,
        "gender": None,
    }
    if "coach_id" not in columns:
        values["coach_id"] = make_coach(session).id
    session.execute(
        text(
            "INSERT INTO players (id, first_name, last_name, username, dominant_hand, gender, "
            "coach_id) VALUES (:id, :first_name, :last_name, :username, :dominant_hand, :gender, "
            ":coach_id)"
        ),
        values | columns,
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


def test_database_requires_a_username(db_session: Session) -> None:
    """The username is the player's sign-in identifier, minted by the server for every
    row; the migration backfilled the ones that predate it, so none is ever null."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, username=None)


def test_database_rejects_a_duplicate_username(db_session: Session) -> None:
    """The unique constraint is what makes the create route's retry loop safe: two
    concurrent creates of namesakes must leave one loser, never two owners of a name."""
    _insert_raw_player(db_session, username="ndlraf001")

    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, username="ndlraf001")


def test_database_rejects_a_username_over_the_column_width(db_session: Session) -> None:
    """String(20) claims six letters plus room for the number to widen past 999.
    Fourteen digits of namesakes is a bound nothing will meet; the test pins that the
    width exists, not where it sits."""
    with pytest.raises(DataError):
        _insert_raw_player(db_session, username="ndlraf" + "1" * 15)


def test_database_requires_an_owner(db_session: Session) -> None:
    """coach_id went NOT NULL with the scoping work: a player nobody owns is a row no
    roster can ever show again, so the database refuses to hold one."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, coach_id=None)


def test_database_rejects_an_unknown_coach_id(db_session: Session) -> None:
    """The foreign key's half of ownership: an id that matches no coach row is
    refused outright rather than stored as a dangling reference."""
    with pytest.raises(IntegrityError):
        _insert_raw_player(db_session, coach_id=uuid.uuid4())


def test_database_refuses_to_delete_a_coach_who_still_has_players(db_session: Session) -> None:
    """The foreign key declares no ondelete on purpose. Deleting the coach is refused
    rather than cascading into their roster and the match history hanging off it."""
    coach = make_coach(db_session)
    _insert_raw_player(db_session, coach_id=coach.id)

    with pytest.raises(IntegrityError):
        db_session.execute(text("DELETE FROM coaches WHERE id = :id"), {"id": coach.id})


def test_coach_id_is_indexed(db_session: Session) -> None:
    """Postgres does not index a foreign key automatically, and one coach's roster is
    the query every list of players becomes — a missing index would show up as nothing
    but a slow page."""
    indexed_columns = {
        tuple(index["column_names"])
        for index in inspect(db_session.connection()).get_indexes("players")
    }

    assert ("coach_id",) in indexed_columns


def test_a_player_without_a_photo_has_no_photo_url(db_session: Session) -> None:
    player = make_player(db_session)

    assert player.photo_key is None
    assert player.photo_url is None


def test_a_stored_photo_key_becomes_a_url(db_session: Session) -> None:
    """The column holds the store's filename; the URL is derived, never written down."""
    player = make_player(db_session, photo_key="mBKcJ7Yh3QhBOTd3ffVXbw")

    assert player.photo_url == "/api/media/mBKcJ7Yh3QhBOTd3ffVXbw.webp"
