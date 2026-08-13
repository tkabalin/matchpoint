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
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Engine, create_engine, inspect, make_url, text

import matchpoint_api.models  # noqa: F401  # register all models on Base.metadata
from matchpoint_api.config import settings
from matchpoint_api.db import Base

ROUND_TRIP_DATABASE = "matchpoint_migration_round_trip"
# Every table the migrations are expected to build. `alembic_version` is deliberately
# absent: Alembic creates it outside the revisions and leaves it behind at base.
MIGRATED_TABLES = frozenset(
    {"coaches", "coach_sessions", "email_verifications", "password_resets", "players", "matches"}
)


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
        assert _table_names(round_trip_url).issuperset(MIGRATED_TABLES)

        command.downgrade(config, "base")
        assert _table_names(round_trip_url).isdisjoint(MIGRATED_TABLES)

        command.upgrade(config, "head")
        assert _table_names(round_trip_url).issuperset(MIGRATED_TABLES)
    finally:
        settings.database_url = original_url


def test_requiring_a_player_owner_refuses_orphans_rather_than_deleting_them(
    round_trip_url: str,
) -> None:
    """`alembic upgrade head` runs unattended on deploy, so a player with no coach has
    to stop the upgrade rather than be cleared out of its way along with its matches."""
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    original_url = settings.database_url
    settings.database_url = round_trip_url
    engine = create_engine(round_trip_url)
    try:
        # The revision before af8b6534855d — the last point at which coach_id is still
        # nullable, and so the only place an orphan can be arranged.
        command.upgrade(config, "29e32ffe5d88")
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO players (id, first_name, last_name) "
                    "VALUES (gen_random_uuid(), 'Orphan', 'Player')"
                )
            )

        with pytest.raises(RuntimeError, match="1 player"):
            command.upgrade(config, "head")
    finally:
        engine.dispose()
        settings.database_url = original_url


def test_the_schema_at_head_matches_the_models(_test_engine: Engine) -> None:
    """Alembic's own autogenerate comparison, asserted rather than printed.

    A column added to a model without a revision to go with it is otherwise invisible:
    the ORM writes through `Base.metadata`, so every test keeps passing until a
    deployment runs against the migrated schema and the column isn't there.

    Reads the shared `matchpoint_test` database, which conftest has already migrated
    to head, so this costs a reflection and nothing else.
    """
    with _test_engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        differences = compare_metadata(context, Base.metadata)

    assert differences == [], "models and migrations disagree — autogenerate a revision"
