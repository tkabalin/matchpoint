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
  visible to requests in the same test. The converse is the trap: a route's uncommitted writes are
  visible to the test too, so asserting database state after a request does not prove the route
  committed.
- Tests must not depend on execution order or leak state. If a test only passes after another has
  run, it is broken.
- Build rows with the factories in `tests/factories.py` rather than constructing models inline, and
  add one there for each new model. They `flush()` rather than `commit()`, which is what keeps a
  fixture row inside the transaction the test rolls back.
- **No test reaches a real email provider.** `tests/__init__.py` pins `settings.email_sender` to the
  logging sender for the whole run, so a machine configured to send real mail still can't while
  `pytest` is running. It lives in the package's own import, not a fixture, because test modules
  build an app at import time — before any fixture runs. Keep it there, don't work around it, and
  **don't repoint the suite's `@example.com` addresses at a provider sink** like
  `delivered@resend.dev` to stop the `422` Resend answers them with. That 422 is the backstop:
  `@example.com` is reserved by RFC 2606 and routes nowhere, so a run that escaped the guard fails
  loudly and for free, where addresses a provider accepts would let the same escape pass silently
  and burn a day's send quota. Anything that genuinely must reach the wire — the deploy smoke check,
  and nothing else — uses a sink address.
- `conftest.py` drops and recreates `matchpoint_test`, so it refuses any non-local database host.
  Don't loosen that guard to make a run work — point `MATCHPOINT_DATABASE_URL` at the local Compose
  Postgres instead. The opt-out env var exists for CI, where the service container is only reachable
  at an alias.

## A Write Needs an Origin

- State-changing requests are refused without an `Origin` header naming the app's own host
  (`csrf.py`), and the `client` fixture sends one by default. A test that builds a `TestClient` of
  its own passes `headers=ORIGIN_HEADERS` and `base_url=TEST_ORIGIN` from `conftest.py`, unless the
  header itself is the subject (`test_csrf.py`), or every write it makes answers 403 for a reason
  that has nothing to do with what it is testing.

See `docs/testing.md` for the unit/integration/e2e split and framework rationale.
