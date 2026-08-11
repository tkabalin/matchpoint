---
paths:
  - apps/api/**
---

## Sync SQLAlchemy, Not Async

- The API uses **sync** SQLAlchemy 2 with psycopg 3 (`postgresql+psycopg://`). Don't introduce
  `create_async_engine`, `AsyncSession`, `async_sessionmaker`, or `asyncpg` — FastAPI runs sync
  routes in a threadpool and our load is club-scale, so async buys nothing and costs
  `MissingGreenlet`-class debugging.
- **Routes that touch the database are declared `def`, not `async def`.** Starlette runs `def`
  routes in an anyio worker thread; an `async def` route runs on the event loop, so a blocking query
  there stalls every other in-flight request, not just its own. Same for dependencies — `get_db` is
  a plain sync generator for this reason.
- `async def` is still correct for routes doing no blocking I/O. If a route must mix real async I/O
  with a DB call, keep it `async def` and push the blocking call out via `run_in_threadpool`; never
  call a sync session directly from the event loop.
- This failure mode is quiet — it passes tests and works fine for one user, surfacing only as
  latency under concurrency. Get the keyword right up front.
- All schema changes go through Alembic, from the first table onward. No hand-edited databases.

## Query Safety

- Every database query must be parameterised — never build a query by interpolating untrusted input
  into it. This is the difference between letting a user filter data and letting them run arbitrary
  SQL against our database.

## Error Responses

- **Never raise a 422 by hand.** FastAPI auto-declares every route's 422 as `HTTPValidationError`,
  whose `detail` is a list of errors, and the generated TypeScript client unpacks it as one — so an
  `HTTPException(422, detail="...")` returns a shape the client cannot read. Pick a status FastAPI
  does not auto-declare; 404 is the project's choice for a body field referencing a row that doesn't
  exist.

## The Generated Client

- A route's request and response models are a published contract: the web app compiles against
  `packages/api-client`, generated from this app's OpenAPI spec. After changing anything a route
  exposes — schema fields, status codes, query parameters, a handler's name — run
  `scripts/gen-api-client.sh` and commit the regenerated spec and client with the change.
- Handler function names become the client's function names (`create_player` → `createPlayer`), so
  they have to stay unique across routers and read well as a call. `tests/test_openapi.py` fails on
  both a stale spec and a name collision.

## Column Defaults

- Timestamp columns default to `clock_timestamp()`, not `now()`. In Postgres `now()` is the
  _transaction_ timestamp, so every row written in one transaction shares a value — silently voiding
  any ordering that uses the column as a tiebreaker.

## Tests

- New behaviour ships with tests. pytest, in `tests/`; route tests go through the `client` /
  `db_session` fixtures against real Postgres. Conventions: `.claude/rules/api-tests.md`; framework:
  `docs/testing.md`.

## Toolchain

- `apps/api` is a uv project and deliberately **not** a pnpm workspace member. Never run
  `pnpm install` here — use `uv sync --group dev`, `uv add`, `uv run`.
