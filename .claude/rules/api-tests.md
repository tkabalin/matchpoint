---
paths:
  - apps/api/tests/**
---

## Layout & Naming

- Tests live in `tests/`, named `test_<module>.py` after the module or router under test; subfolders
  always mirror `src/matchpoint_api/` — e.g. a test for `src/matchpoint_api/routers/matches.py` goes
  in `tests/routers/test_matches.py`, from the first test, not once the suite feels big. Tests for
  top-level modules (`main.py`) stay at the root of `tests/`.
- Every test folder is a package, `tests/` included — keep the `__init__.py` files. Mirroring gives
  two layers' tests for one model the same basename, which pytest's default import mode refuses to
  collect unless the folders are packages.
- Unit tests for pure logic take no fixtures. Anything exercising a route goes through the `client`
  fixture from `conftest.py`.
- Default to an integration test unless the code under test is pure logic with no I/O — see
  `docs/testing.md` for the full unit/integration/e2e split.

## Database Tests

- Integration tests run against real Postgres — the `matchpoint_test` database on the Compose
  instance, migrated to Alembic head once per run. Never SQLite, never a mocked session.
- Use the `db_session` fixture. Each test runs inside a savepoint rolled back on teardown — don't
  create or drop tables in tests, and don't clean up rows manually; the rollback handles it.
- `client` uses the same session via dependency override, so data arranged through `db_session` is
  visible to requests in the same test.
- Tests must not depend on execution order or leak state. If a test only passes after another has
  run, it is broken.

See `docs/testing.md` for the unit/integration/e2e split and framework rationale.
