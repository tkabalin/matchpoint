# Testing

How MatchPoint is tested: what each level of test is for, where tests live, and the conventions each
app follows. Commands for running the suites are in the README under "Check your work".

## Test levels

| Level       | What it exercises                                                  | Tooling                                        |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Unit        | One function or module in isolation — no DOM, network, or database | Vitest / pytest                                |
| Integration | A slice of the app through its public surface                      | Vitest + Testing Library / pytest + TestClient |
| E2E         | A real browser driving the running app                             | Playwright                                     |

- **Unit tests** cover pure logic: the scoring engine, reducers, formatting helpers, analytics
  computations. They take no fixtures and touch no I/O. This is where combinatorial cases (scoring
  rules, edge sequences) are enumerated cheaply.
- **Integration tests** are the default level. On the web they render a component or feature slice
  and interact with it the way a user would; on the API they issue an HTTP request through the
  FastAPI app and assert on the response and what was persisted. They test behaviour through the
  public surface — a refactor that preserves behaviour should not break them.
- **E2E tests** are a small set of critical journeys (e.g. capturing points in a live match) run in
  a real browser. They are the slowest and most brittle level, so a flow gets an e2e test only when
  an integration test cannot provide confidence in it.

When in doubt, write an integration test.

## Frontend (`apps/web`)

Unit and integration tests run on **Vitest** (jsdom environment) with **Testing Library**; browser
e2e runs on **Playwright**. The runners are kept apart by location and naming: Vitest picks up only
`src/**/*.test.{ts,tsx}`, Playwright only `e2e/*.spec.ts`.

### Unit & integration tests

- Tests live **next to the code they test** — `state.test.ts` beside `state.ts` — always, with no
  promotion to a `__tests__/` folder as a slice grows. Vitest and Jest are both optimized for this
  layout, imports stay short instead of climbing out to a separate test tree, and moving or deleting
  a module takes its tests with it automatically. A single fixed convention is also easier for
  contributors (human or AI) to apply consistently than a size-based threshold.
- `src/test-setup.ts` (registered via `test.setupFiles`) wires the jest-dom matchers, and registers
  `fake-indexeddb` because jsdom implements none: without it the offline outbox has no database to
  open. It is global rather than per-file since Dexie reads the global at open time.
- Interactions go through `@testing-library/user-event`; queries prefer accessible roles
  (`getByRole("button", { name: "Save" })`), so tests double as a basic accessibility check.

### Contract checks against the API

The API's OpenAPI spec is the only description of the wire contract both sides agree on, so both
checks are generated from it rather than written by hand:

- **Types.** A function that builds a request body is annotated with the generated type: the match
  payload builder returns `MatchCreate`. A field the API renames, removes, or retypes then fails
  `tsc` in the web app instead of returning a 422 in front of a coach.
- **Schemas.** The generator also emits Zod schemas alongside the types
  (`@matchpoint/api-client/zod`). These keep what TypeScript erases: a date, a UUID, and a
  length-bounded string are all just `string` once compiled. A test parses the built body with the
  schema for the endpoint it is bound for.

Neither reaches validation the spec cannot express. Bounds enforced in Python, such as a date that
must not be in the future, appear nowhere in the schema and need their own check on the client.

Prefer both over a hand-written mock of the API. A mock can be quietly edited until it agrees with
the code under test, which is how a form ships green and 422s on every real submission; generated
output cannot be edited without the generator's input changing first.

### E2E tests

- Specs live in `apps/web/e2e/`, configured by `apps/web/playwright.config.ts`.
- Playwright starts the Vite dev server itself (`webServer`), so `pnpm run test:e2e` is
  self-contained.
- Projects cover desktop Chromium plus mobile emulation in Chromium and WebKit — the capture screen
  is used phone-in-hand, and installed-PWA users are on iOS Safari.

## Backend (`apps/api`)

All tests run on **pytest** and live in `apps/api/tests/`, outside the application package (the
Python idiom for a `src/` layout). Files are named `test_<module>.py` after the module under test,
in subfolders mirroring the source tree (`tests/models/`, `tests/routers/`, `tests/schemas/`) from
the first test rather than once the suite feels large. Tests for top-level modules stay at the root
of `tests/`.

Each test folder is a package. Mirroring reproduces the source tree's module names, so one model
tested at two layers yields two files sharing a basename — which pytest's default import mode
refuses to collect unless the folders are packages. It also makes shared helpers importable as
`tests.factories`.

- **Unit tests** import the function and call it — no fixtures.
- **Integration tests** use two fixtures from `tests/conftest.py`:
  - `client` — a `TestClient` running the app, with the database dependency overridden to use the
    test session.
  - `db_session` — a session bound to a dedicated `matchpoint_test` database, created on the same
    Compose Postgres instance and migrated to Alembic head once per run. Each test executes inside a
    savepoint that is rolled back on teardown, so tests stay isolated without re-creating the
    schema, and commits made by application code are undone too.
- Integration tests run against real Postgres, never SQLite or a mocked session — analytics queries
  are exactly the code where engine differences bite.

Local runs expect the Compose Postgres to be up (`docker compose up -d`); CI provides a Postgres
service container.

### Why not mock the database

A mocked session can't reproduce Postgres-specific behaviour (aggregate functions, date/interval
arithmetic, `NUMERIC` rounding) that the analytics queries rely on; a test suite green against a
mock but wrong against real Postgres is worse than no test. The savepoint-rollback fixture keeps the
cost close to that of a mock, so there is no speed reason to give up the fidelity. Mocking stays
legitimate for genuine third-party dependencies should MatchPoint ever acquire one.

## CI and coverage

CI runs the same commands as `scripts/check.sh` in verify mode, plus the Playwright suite. Both apps
collect coverage and emit JUnit reports, so merge requests are annotated with failures and a
coverage figure. Coverage is informational — there is no enforced threshold; review judges whether
behaviour is adequately tested.

## Regression testing

The full suite (unit, integration, and e2e) runs on every push via CI, so a change that breaks
previously-passing behaviour anywhere in the app fails the pipeline before it can merge. A test is
only removed when the behaviour it covers is intentionally removed — never to make a failing suite
pass. If a bug slips through, the fix ships alongside a test that reproduces it, so the same
regression can't recur silently.
