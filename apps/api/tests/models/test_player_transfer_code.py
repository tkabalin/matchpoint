import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import PlayerTransferCode
from tests.factories import make_player, make_player_transfer_code

HASH_LIMIT = 64
NOT_NULL_COLUMNS = ["player_id", "token_hash"]


def test_transfer_code_round_trips(db_session: Session) -> None:
    player = make_player(db_session)
    token_hash = "a" * HASH_LIMIT
    row = make_player_transfer_code(db_session, player_id=player.id, token_hash=token_hash)
    db_session.commit()

    saved = db_session.get(PlayerTransferCode, row.id)
    assert saved is not None
    assert saved.player_id == player.id
    assert saved.token_hash == token_hash
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# As with the other credential tables, the constraints are pinned against writes that
# never pass through the ORM, because the database is what holds each line.


def _insert_raw_code(session: Session, **columns: object) -> None:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "player_id": make_player(session).id,
        "token_hash": "b" * HASH_LIMIT,
    }
    session.execute(
        text(
            "INSERT INTO player_transfer_codes (id, player_id, token_hash) "
            "VALUES (:id, :player_id, :token_hash)"
        ),
        defaults | columns,
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """A code naming no player transfers nobody, and a NULL hash is a row no code can
    ever match."""
    with pytest.raises(IntegrityError):
        _insert_raw_code(db_session, **{column: None})


def test_database_rejects_a_second_code_for_the_same_player(db_session: Session) -> None:
    """One live code per player is the design: it is what makes minting again a
    replacement rather than a second concurrently-valid way to take the same player."""
    player = make_player(db_session)
    make_player_transfer_code(db_session, player_id=player.id)

    with pytest.raises(IntegrityError):
        _insert_raw_code(db_session, player_id=player.id)


def test_database_rejects_a_reused_token_hash(db_session: Session) -> None:
    """Redeeming finds the row by this value, so two rows sharing one would make which
    player a code moves a matter of which row the query happened to return."""
    make_player_transfer_code(db_session, token_hash="c" * HASH_LIMIT)

    with pytest.raises(IntegrityError):
        _insert_raw_code(db_session, token_hash="c" * HASH_LIMIT)


def test_database_refuses_a_code_for_a_player_that_does_not_exist(db_session: Session) -> None:
    """The foreign key is what lets redeeming join to the player without a null check."""
    with pytest.raises(IntegrityError):
        _insert_raw_code(db_session, player_id=uuid.uuid4())


def test_database_bounds_the_token_hash_at_the_hash_width(db_session: Session) -> None:
    """The column is sized to SHA-256 hex exactly, so a longer value is a bug rather
    than a value to store."""
    with pytest.raises(DataError):
        _insert_raw_code(db_session, token_hash="d" * (HASH_LIMIT + 1))
