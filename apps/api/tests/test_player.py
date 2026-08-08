import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from matchpoint_api.models import DominantHand, Gender, Player


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
