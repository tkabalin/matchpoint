"""Migrations are exercised on a database of their own.

conftest's `matchpoint_test` is created once and shared by every other test, so
downgrading it mid-run would pull the schema out from under them — and a failure
partway through would leave every later test failing for a reason that has
nothing to do with what it was testing.

Nothing else covers this: `migrations/` sits outside the `source` that coverage
measures, so a `downgrade()` that cannot run is invisible to both the suite and
the coverage figure.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, make_url, text

from matchpoint_api.config import settings

ROUND_TRIP_DATABASE = "matchpoint_migration_round_trip"


def _table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


@pytest.fixture
def round_trip_url(_test_engine: Engine) -> Iterator[str]:
    """An empty database to migrate up and down.

    Depends on `_test_engine` for its local-host guard: by the time this runs,
    conftest has already refused to touch a non-local server.
    """
    base = make_url(settings.database_url)
    admin_engine = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {ROUND_TRIP_DATABASE} WITH (FORCE)"))
            conn.execute(text(f"CREATE DATABASE {ROUND_TRIP_DATABASE}"))

        yield base.set(database=ROUND_TRIP_DATABASE).render_as_string(hide_password=False)

        with admin_engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {ROUND_TRIP_DATABASE} WITH (FORCE)"))
    finally:
        admin_engine.dispose()


def test_migrations_upgrade_downgrade_and_upgrade_again(round_trip_url: str) -> None:
    """A downgrade that cannot run is a migration that cannot be rolled back."""
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    # migrations/env.py reads the URL from the settings singleton, so pointing it
    # at the round-trip database is what keeps this off matchpoint_test.
    original_url = settings.database_url
    settings.database_url = round_trip_url
    try:
        command.upgrade(config, "head")
        assert "players" in _table_names(round_trip_url)

        command.downgrade(config, "base")
        assert "players" not in _table_names(round_trip_url)

        command.upgrade(config, "head")
        assert "players" in _table_names(round_trip_url)
    finally:
        settings.database_url = original_url
