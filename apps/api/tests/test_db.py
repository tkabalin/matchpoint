"""The request-scoped session dependency.

Every other test replaces `get_db` with the transactional `db_session`, so the
generator the running app actually depends on is exercised nowhere else — and the
half that matters is the half after the yield, where the session is released.
"""

from sqlalchemy import select

from matchpoint_api.db import get_db


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
