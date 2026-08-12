import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from matchpoint_api.models import EmailVerification
from tests.factories import make_email_verification

HASH_LIMIT = 64
EMAIL_LIMIT = 254
NOT_NULL_COLUMNS = ["email", "attempts", "expires_at"]


def test_email_verification_round_trips(db_session: Session) -> None:
    otp_hash = "a" * 64
    expires_at = datetime.now(UTC) + timedelta(minutes=10)
    row = make_email_verification(
        db_session, email="pending@example.com", otp_hash=otp_hash, expires_at=expires_at
    )
    db_session.commit()

    saved = db_session.get(EmailVerification, row.id)
    assert saved is not None
    assert saved.email == "pending@example.com"
    assert saved.otp_hash == otp_hash
    assert saved.token_hash is None
    assert saved.attempts == 0
    assert saved.expires_at == expires_at
    assert isinstance(saved.id, uuid.UUID)
    assert saved.created_at is not None
    assert saved.updated_at is not None


# As with the coach and session tests, the constraints are pinned against writes that
# never pass through the ORM, because the database is what holds each line.


def _insert_raw_verification(session: Session, **columns: object) -> None:
    defaults: dict[str, object] = {
        "id": uuid.uuid4(),
        "email": f"raw-{uuid.uuid4()}@example.com",
        "otp_hash": "b" * 64,
        "token_hash": None,
        "attempts": 0,
        "expires_at": datetime.now(UTC) + timedelta(minutes=10),
    }
    session.execute(
        text(
            "INSERT INTO email_verifications "
            "(id, email, otp_hash, token_hash, attempts, expires_at) "
            "VALUES (:id, :email, :otp_hash, :token_hash, :attempts, :expires_at)"
        ),
        defaults | columns,
    )


@pytest.mark.parametrize("column", NOT_NULL_COLUMNS)
def test_database_requires_every_column(db_session: Session, column: str) -> None:
    """A verification without an address or a deadline is one nothing could ever
    answer or expire, and a NULL attempts would make the guessing cap unenforceable."""
    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, **{column: None})


def test_database_rejects_a_second_row_for_the_same_address(db_session: Session) -> None:
    """One live verification per address is the design: it is what makes a re-request
    a replacement, and what keeps N simultaneously-valid codes from ever existing."""
    make_email_verification(db_session, email="pending@example.com")

    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, email="pending@example.com")


def test_database_rejects_a_duplicate_token_hash(db_session: Session) -> None:
    """token_hash is the key the row is consumed by at sign-up; two rows sharing one
    would make a presented verification ambiguous."""
    _insert_raw_verification(db_session, otp_hash=None, token_hash="c" * 64)

    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, otp_hash=None, token_hash="c" * 64)


def test_database_permits_many_rows_at_the_code_stage(db_session: Session) -> None:
    """The unique token_hash must not collapse the common case: most rows hold a code
    and no token, and Postgres treats their NULLs as distinct."""
    _insert_raw_verification(db_session)
    _insert_raw_verification(db_session)


@pytest.mark.parametrize("column", ["otp_hash", "token_hash"])
def test_database_rejects_a_hash_over_the_column_width(db_session: Session, column: str) -> None:
    """64 characters is exactly a SHA-256 in hex, so the width is a tripwire for a
    writer that stored a plaintext secret instead of its digest."""
    overrides: dict[str, object] = {"otp_hash": None, "token_hash": None}
    overrides[column] = "d" * (HASH_LIMIT + 1)
    with pytest.raises(DataError):
        _insert_raw_verification(db_session, **overrides)


def test_database_rejects_an_email_over_the_column_width(db_session: Session) -> None:
    with pytest.raises(DataError):
        _insert_raw_verification(db_session, email=f"{'e' * EMAIL_LIMIT}@example.com")


def test_database_rejects_an_email_that_is_not_lowercased(db_session: Session) -> None:
    """No `validates` normaliser guards this column — request-otp writes it through a
    Core upsert, which would bypass one — so the CHECK is the only thing standing
    between MIKE@ and mike@ being two rows, each with a live code of its own."""
    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, email="Pending@example.com")


def test_database_rejects_a_row_holding_both_secrets(db_session: Session) -> None:
    """The CHECK's first half: a row holding a live code and a proven token at once
    would be two credentials for the price of one state."""
    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, otp_hash="f" * 64, token_hash="f" * 64)


def test_database_rejects_a_row_holding_neither_secret(db_session: Session) -> None:
    """And its second half: a row with nothing to answer is a row that can never be
    answered or consumed — only replaced. It must not be writable."""
    with pytest.raises(IntegrityError):
        _insert_raw_verification(db_session, otp_hash=None, token_hash=None)
