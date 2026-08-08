from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.orm import Session

from matchpoint_api.config import settings
from matchpoint_api.db import get_db
from matchpoint_api.main import create_app

TEST_DATABASE = "matchpoint_test"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


@pytest.fixture(scope="session")
def _test_engine() -> Iterator[Engine]:
    """A fresh matchpoint_test database on the Compose server, migrated to Alembic head."""
    dev_url = make_url(settings.database_url)
    # This fixture drops a database, so refuse any server that isn't local: a
    # MATCHPOINT_DATABASE_URL pointed at a deployed Postgres would otherwise run
    # DDL on it the moment someone types `pytest`.
    if dev_url.host not in LOCAL_HOSTS:
        raise RuntimeError(
            f"Refusing to recreate {TEST_DATABASE} on non-local host {dev_url.host!r}. "
            "Point MATCHPOINT_DATABASE_URL at the local Compose Postgres to run the tests."
        )
    admin_engine = create_engine(dev_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            # FORCE so a stray psql or GUI session holding the test database open
            # doesn't take the whole run down with it.
            conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DATABASE} WITH (FORCE)"))
            conn.execute(text(f"CREATE DATABASE {TEST_DATABASE}"))
    finally:
        admin_engine.dispose()

    # migrations/env.py reads its URL from settings, so retargeting settings points
    # the upgrade below at the test database. It does not move
    # matchpoint_api.db.engine, which is bound to the dev URL at import time —
    # routes reach the test database through the get_db override in `client`.
    settings.database_url = dev_url.set(database=TEST_DATABASE).render_as_string(
        hide_password=False
    )
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")

    engine = create_engine(settings.database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(_test_engine: Engine) -> Iterator[Session]:
    """A session inside an outer transaction that is rolled back after each test.

    join_transaction_mode="create_savepoint" turns commit() in code under test into
    a savepoint release, so committed data stays visible within the test but never
    escapes the outer transaction.

    expire_on_commit mirrors the production session_factory, so post-commit attribute
    access behaves in tests the way it does in the running app.
    """
    with _test_engine.connect() as connection:
        transaction = connection.begin()
        session = Session(
            connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()


@pytest.fixture
def client(request: pytest.FixtureRequest) -> Iterator[TestClient]:
    """A test client whose routes share the requesting test's db_session.

    The session is resolved on first use rather than up front, so routes that never
    touch the database (/health) don't need a running Postgres.
    """
    app = create_app()
    app.dependency_overrides[get_db] = lambda: request.getfixturevalue("db_session")
    with TestClient(app) as client:
        yield client
