import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import PlayerSession
from tests.factories import make_player, make_player_session

TOKEN_HASH_LIMIT = 64
NOT_NULL_COLUMNS = ["player_id", "token_hash", "expires_at"]


def test_player_session_round_trips(db_session: Session) -> None:
    token_hash = "a" * 64
    expires_at = datetime.now(UTC) + timedelta(days=30)
    player = make_player(db_session)
    session_row = make_player_session(
        db_session, player_id=player.id, token_hash=token_hash, expires_at=expires_at
    )
    db_session.commit()

    saved = db_session.get(PlayerSession, session_row.id)
    assert saved is not None
    assert saved.player_id == player.id
    assert saved.token_hash == token_hash
    assert saved.expires_at == expires_at
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# The constraints below mirror coach_sessions', and are pinned the same way: against
# writes that never pass through the ORM, because the database is what holds each line.


def _insert_raw_session(session: Session, **columns: object) -> None:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "player_id": make_player(session).id,
        "token_hash": "b" * 64,
        "expires_at": datetime.now(UTC) + timedelta(days=30),
    }
    session.execute(
        text(
            "INSERT INTO player_sessions (id, player_id, token_hash, expires_at) "
            "VALUES (:id, :player_id, :token_hash, :expires_at)"
        ),
        defaults | columns,
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """A session missing any of the three is one no request could ever present, or
    one that never dies; the NOT NULL comes from the model's bare Mapped[...]."""
    with pytest.raises(IntegrityError):
        _insert_raw_session(db_session, **{column: None})


def test_database_rejects_a_duplicate_token_hash(db_session: Session) -> None:
    """token_hash is the lookup key on every authenticated player request; two rows
    sharing one would make a presented token an ambiguous login."""
    _insert_raw_session(db_session, token_hash="c" * 64)

    with pytest.raises(IntegrityError):
        _insert_raw_session(db_session, token_hash="c" * 64)


def test_database_rejects_a_token_hash_over_the_column_width(db_session: Session) -> None:
    """64 characters is exactly a SHA-256 in hex, so the width is a tripwire for a
    writer that stored the token itself, the one value this column must keep out."""
    with pytest.raises(DataError):
        _insert_raw_session(db_session, token_hash="d" * (TOKEN_HASH_LIMIT + 1))


def test_database_requires_the_player_to_exist(db_session: Session) -> None:
    """The foreign key: a session row authenticating nobody must be unwritable."""
    with pytest.raises(IntegrityError):
        _insert_raw_session(db_session, player_id=uuid.uuid4())


def test_a_player_with_sessions_cannot_be_hard_deleted(db_session: Session) -> None:
    """No ondelete, as everywhere in the schema: raw deletion of a player out from
    under their live logins is refused, which is what makes the delete route's own
    revocation a thing a test can prove rather than a habit."""
    session_row = make_player_session(db_session)

    with pytest.raises(IntegrityError):
        db_session.execute(
            text("DELETE FROM players WHERE id = :id"), {"id": session_row.player_id}
        )
