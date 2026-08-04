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

## Toolchain

- `apps/api` is a uv project and deliberately **not** a pnpm workspace member. Never run
  `pnpm install` here — use `uv sync --group dev`, `uv add`, `uv run`.
