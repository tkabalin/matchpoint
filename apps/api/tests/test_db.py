"""The request-scoped session dependency.

Every other test replaces `get_db` with the transactional `db_session`, so the
generator the running app actually depends on is exercised nowhere else — and the
half that matters is the half after the yield, where the session is released.
"""

from sqlalchemy import func, select

from matchpoint_api.db import engine, get_db


def test_the_pool_validates_a_connection_before_handing_it_over() -> None:
    """A dead connection out of the pool is an `OperationalError` on the first query, so a
    500 for whoever arrives after an idle spell. Read off the pool because that is the only
    place the setting exists once the engine is built, private attribute and all.
    """
    assert engine.pool._pre_ping is True  # pyright: ignore[reportPrivateUsage]


def test_get_db_yields_a_usable_session_and_releases_it() -> None:
    """Uses the module's own engine, which binds to the configured database at import
    time and so is not redirected to `matchpoint_test` by conftest. `SELECT 1` needs
    no schema and writes nothing, which is what keeps that safe.
    """
    sessions = get_db()
    session = next(sessions)

    assert session.scalar(select(1)) == 1
    assert session.in_transaction()

    # Exhausting the generator is what FastAPI does once the response is sent. Without
    # it the connection would never go back to the pool.
    assert next(sessions, None) is None
    assert not session.in_transaction()


def test_the_engine_runs_at_the_isolation_the_otp_attempt_cap_assumes() -> None:
    """`verify_otp` bounds guessing at OTP_ATTEMPT_LIMIT only because a losing concurrent
    UPDATE blocks on the winner's row lock and then re-evaluates its own WHERE against the
    committed new version — READ COMMITTED behaviour, relied on there but requested
    nowhere. Under REPEATABLE READ that loser is a serialization failure, so the guess
    owed the same 400 as every other failure answers 500 instead, and which one it was is
    exactly the fact that 400 exists to withhold.

    Read from inside the transaction rather than off SQLAlchemy's execution options,
    because both ways of losing the assumption land here: an `isolation_level` passed to
    `create_engine`, and a server-side `default_transaction_isolation` that moved. Safe on
    the module's own engine for the reason above — no schema, and nothing written.
    """
    sessions = get_db()
    session = next(sessions)

    isolation = session.scalar(select(func.current_setting("transaction_isolation")))

    assert isolation == "read committed"
    assert next(sessions, None) is None
