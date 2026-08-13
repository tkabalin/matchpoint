import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import PasswordReset
from tests.factories import make_coach, make_password_reset

HASH_LIMIT = 64
NOT_NULL_COLUMNS = ["coach_id", "otp_hash", "attempts", "expires_at"]


def test_password_reset_round_trips(db_session: Session) -> None:
    coach = make_coach(db_session)
    otp_hash = "a" * 64
    expires_at = datetime.now(UTC) + timedelta(minutes=10)
    row = make_password_reset(
        db_session, coach_id=coach.id, otp_hash=otp_hash, expires_at=expires_at
    )
    db_session.commit()

    saved = db_session.get(PasswordReset, row.id)
    assert saved is not None
    assert saved.coach_id == coach.id
    assert saved.otp_hash == otp_hash
    assert saved.attempts == 0
    assert saved.expires_at == expires_at
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# As with the verification tests, the constraints are pinned against writes that never
# pass through the ORM, because the database is what holds each line.


def _insert_raw_reset(session: Session, **columns: object) -> None:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "coach_id": make_coach(session).id,
        "otp_hash": "b" * 64,
        "attempts": 0,
        "expires_at": datetime.now(UTC) + timedelta(minutes=10),
    }
    session.execute(
        text(
            "INSERT INTO password_resets (id, coach_id, otp_hash, attempts, expires_at) "
            "VALUES (:id, :coach_id, :otp_hash, :attempts, :expires_at)"
        ),
        defaults | columns,
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """A reset without an account or a deadline is one nothing could ever answer or
    expire, and a NULL attempts would make the guessing cap unenforceable."""
    with pytest.raises(IntegrityError):
        _insert_raw_reset(db_session, **{column: None})


def test_database_rejects_a_second_row_for_the_same_coach(db_session: Session) -> None:
    """One live reset per coach is the design: it is what makes a re-request a
    replacement, and what keeps N simultaneously-valid codes from ever existing."""
    coach = make_coach(db_session)
    make_password_reset(db_session, coach_id=coach.id)

    with pytest.raises(IntegrityError):
        _insert_raw_reset(db_session, coach_id=coach.id)


def test_database_rejects_an_unknown_coach(db_session: Session) -> None:
    with pytest.raises(IntegrityError):
        _insert_raw_reset(db_session, coach_id=uuid.uuid4())


def test_database_refuses_to_delete_a_coach_with_a_pending_reset(db_session: Session) -> None:
    """No ondelete, as on every foreign key here: nothing deletes a coach today, and
    anything that tries must be refused rather than quietly taking the reset along."""
    coach = make_coach(db_session)
    make_password_reset(db_session, coach_id=coach.id)

    with pytest.raises(IntegrityError):
        db_session.execute(text("DELETE FROM coaches WHERE id = :id"), {"id": coach.id})


def test_database_rejects_a_hash_over_the_column_width(db_session: Session) -> None:
    """64 characters is exactly a SHA-256 in hex, so the width is a tripwire for a
    writer that stored the plaintext code instead of its digest."""
    with pytest.raises(DataError):
        _insert_raw_reset(db_session, otp_hash="c" * (HASH_LIMIT + 1))
