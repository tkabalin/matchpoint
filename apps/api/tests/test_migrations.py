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
from typing import Any

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
    {
        "coaches",
        "coach_sessions",
        "email_verifications",
        "password_resets",
        "players",
        "player_notes",
        "player_sessions",
        "player_transfer_codes",
        "matches",
        "match_sets",
        "points",
        "score_checkpoints",
        "deleted_matches",
    }
)


def _table_names(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _current_revision(engine: Engine) -> str | None:
    """The revision the database is stamped at, or None at base."""
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def _schema_snapshot(engine: Engine) -> dict[str, Any]:
    """Everything the migrations build, in a form two of these can be compared by.

    Tables and their columns alone would miss most of what a revision does — a CHECK
    holding an enum's members, a unique constraint, an index — so each of those is
    reflected too, and ordered, since neither PostgreSQL nor the dialect promises to
    return them the same way twice. `alembic_version` is excluded: it holds the
    position, not the schema.
    """
    inspector = inspect(engine)
    return {
        name: {
            # Keyed by column name, and the type rendered: reflection hands back a
            # fresh type object each time, which compares by identity, and PostgreSQL
            # can only append a column it is asked to re-add, so a column a downgrade
            # restores is in a different ordinal position than the one that built it.
            # Neither is the schema; what the column is, is.
            "columns": {
                column["name"]: {**column, "type": str(column["type"])}
                for column in inspector.get_columns(name)
            },
            "primary_key": inspector.get_pk_constraint(name),
            "foreign_keys": sorted(inspector.get_foreign_keys(name), key=repr),
            "indexes": sorted(inspector.get_indexes(name), key=repr),
            "unique_constraints": sorted(inspector.get_unique_constraints(name), key=repr),
            "check_constraints": sorted(inspector.get_check_constraints(name), key=repr),
        }
        for name in inspector.get_table_names()
        if name != "alembic_version"
    }


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


def test_every_downgrade_leaves_the_schema_the_upgrade_found(round_trip_url: str) -> None:
    """A downgrade has to undo its own revision, not merely run without raising.

    Walking head to base and back gets that far and no further: whatever the last
    revision drops takes the whole schema with it, so a downgrade body emptied of the
    `drop_column`, `drop_constraint` or `drop_index` that belongs in it is invisible
    either way round. What catches one is comparing the two directions revision by
    revision — the schema a downgrade steps back to against the one the matching
    upgrade built from the same place — which is what this does.
    """
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    # migrations/env.py reads the URL from the settings singleton, so pointing it
    # at the round-trip database is what keeps this off matchpoint_test.
    original_url = settings.database_url
    settings.database_url = round_trip_url
    engine = create_engine(round_trip_url)
    try:
        command.upgrade(config, "head")
        assert _table_names(round_trip_url).issuperset(MIGRATED_TABLES)

        stepping_down = {_current_revision(engine): _schema_snapshot(engine)}
        while _current_revision(engine) is not None:
            command.downgrade(config, "-1")
            stepping_down[_current_revision(engine)] = _schema_snapshot(engine)
        assert _table_names(round_trip_url).isdisjoint(MIGRATED_TABLES)

        # One step at a time back up, each landing compared against the snapshot the
        # walk down left at the same revision. Head is in there too, so the last
        # comparison is also the round trip the whole walk makes.
        for _ in range(len(stepping_down) - 1):
            command.upgrade(config, "+1")
            revision = _current_revision(engine)
            assert _schema_snapshot(engine) == stepping_down[revision], (
                f"revision {revision} is not the schema the revision above it downgrades to"
            )
        assert _table_names(round_trip_url).issuperset(MIGRATED_TABLES)
    finally:
        engine.dispose()
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


def test_the_username_backfill_numbers_existing_players_deterministically(
    round_trip_url: str,
) -> None:
    """Players predating usernames get theirs minted by the revision itself, oldest
    row first, with a frozen copy of the app's folding, so the same data always
    backfills to the same usernames and namesakes never swap numbers."""
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    original_url = settings.database_url
    settings.database_url = round_trip_url
    engine = create_engine(round_trip_url)
    try:
        # A revision from before 2d16f09c42f3 added usernames: the only place a
        # player the backfill must cover can be arranged.
        command.upgrade(config, "f989e0ca10e9")
        with engine.begin() as connection:
            coach_id = connection.execute(
                text(
                    "INSERT INTO coaches (id, email, display_name, password_hash) "
                    "VALUES (gen_random_uuid(), 'coach@example.com', 'Coach', 'not-a-hash') "
                    "RETURNING id"
                )
            ).scalar()
            for first_name, last_name in [
                ("Sam", "Smith"),  # the elder namesake, so 001 by created_at
                ("Seán", "O'Brien"),  # accents and punctuation fold away
                ("Sam", "Smith"),
                ("Bo", "Li"),  # short names pad to keep the prefix six wide
            ]:
                connection.execute(
                    text(
                        "INSERT INTO players (id, first_name, last_name, coach_id) "
                        "VALUES (gen_random_uuid(), :first_name, :last_name, :coach_id)"
                    ),
                    {"first_name": first_name, "last_name": last_name, "coach_id": coach_id},
                )

        command.upgrade(config, "head")

        with engine.begin() as connection:
            usernames = (
                connection.execute(text("SELECT username FROM players ORDER BY created_at, id"))
                .scalars()
                .all()
            )
        assert usernames == ["smtsam001", "obrsea001", "smtsam002", "lixbox001"]
    finally:
        engine.dispose()
        settings.database_url = original_url


def test_dropping_mid_clears_the_placement_rather_than_the_point(round_trip_url: str) -> None:
    """A ball captured as "mid" loses its half along with its depth, and keeps its point.

    Clearing the depth alone would leave a half without one, which is the pair
    `point_ball_zone_paired` refuses, so an unattended `alembic upgrade head` would stop
    on a constraint that has nothing to do with the revision (#248)."""
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    original_url = settings.database_url
    settings.database_url = round_trip_url
    engine = create_engine(round_trip_url)
    try:
        # The revision before 3cc713083c2a, and so the only place a "mid" ball can be
        # arranged: after it the CHECK refuses the value outright.
        command.upgrade(config, "36b383a5bcc2")
        with engine.begin() as connection:
            coach_id = connection.execute(
                text(
                    "INSERT INTO coaches (id, email, display_name, password_hash) "
                    "VALUES (gen_random_uuid(), 'coach@example.com', 'Coach', 'not-a-hash') "
                    "RETURNING id"
                )
            ).scalar()
            player_id = connection.execute(
                text(
                    "INSERT INTO players (id, first_name, last_name, username, coach_id) "
                    "VALUES (gen_random_uuid(), 'Sam', 'Smith', 'smtsam001', :coach_id) "
                    "RETURNING id"
                ),
                {"coach_id": coach_id},
            ).scalar()
            match_id = connection.execute(
                text(
                    "INSERT INTO matches (id, player_id, played_on) "
                    "VALUES (gen_random_uuid(), :player_id, '2026-08-01') RETURNING id"
                ),
                {"player_id": player_id},
            ).scalar()
            # Same half on both, so the only thing that can tell them apart afterwards
            # is the band the revision was aimed at.
            for sequence, depth in [(0, "mid"), (1, "deep")]:
                connection.execute(
                    text(
                        "INSERT INTO points (id, match_id, sequence, server, won, "
                        "serve1_outcome, end_reason, ball_in, ball_half, ball_depth, "
                        "set_number, game_number, in_tiebreak, is_break_point, is_game_point, "
                        "is_game_end, is_set_point, is_set_end, is_match_point) "
                        "VALUES (gen_random_uuid(), :match_id, :sequence, 'tracked', true, "
                        "'in', 'forced', true, 'ad', :depth, 1, 1, false, false, false, "
                        "false, false, false, false)"
                    ),
                    {"match_id": match_id, "sequence": sequence, "depth": depth},
                )

        command.upgrade(config, "head")

        with engine.begin() as connection:
            placements = connection.execute(
                text("SELECT ball_in, ball_half, ball_depth FROM points ORDER BY sequence")
            ).all()
        assert placements == [(True, None, None), (True, "ad", "deep")]
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
