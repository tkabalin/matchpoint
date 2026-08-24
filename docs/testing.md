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
`src/**/*.test.{ts,tsx}`, Playwright only `e2e/*.spec.ts` and the `e2e/*.setup.ts` its projects
depend on.

### Unit & integration tests

- Tests live **next to the code they test** — `state.test.ts` beside `state.ts` — always, with no
  promotion to a `__tests__/` folder as a slice grows. Vitest and Jest are both optimized for this
  layout, imports stay short instead of climbing out to a separate test tree, and moving or deleting
  a module takes its tests with it automatically. A single fixed convention is also easier for
  contributors (human or AI) to apply consistently than a size-based threshold.
- `src/test-setup.ts` (registered via `test.setupFiles`) wires the jest-dom matchers, and registers
  `fake-indexeddb` because jsdom implements none: without it the offline outbox has no database to
  open. It is global rather than per-file since Dexie reads the global at open time.
- The same file stands in for the browser APIs jsdom lacks. One of them is not a stub of
  convenience: `ResizeObserver` reports a real size, because recharts keeps a chart's own initial
  dimensions only while `ResizeObserver` is undefined. A no-op stub makes it measure jsdom's 0×0 and
  render nothing, so whether any chart draws in a test at all depends on this.
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
- Playwright starts everything the suite needs itself (`webServer`): the Vite dev server, and the
  API beside it through `scripts/e2e-api.sh`. Local runs expect the Compose Postgres to be up
  (`docker compose up -d`); CI provides a service container. The API is always started fresh rather
  than adopted from the port, so a dev stack has to be stopped first: its database, its mail sender
  and its rate limits are not the ones the suite needs.
- Projects cover desktop Chromium plus mobile emulation in Chromium and WebKit — the capture screen
  is used phone-in-hand, and installed-PWA users are on iOS Safari.
- A `setup` project signs one coach up through the real sign-up flow and saves the session it earns.
  Specs that need to be signed in adopt it with `test.use({ storageState })`; the rest run signed
  out, which is how the route guard's redirect gets covered too.

#### Offline and service-worker behaviour

Capture has to keep working with no connection, and the service worker is what makes that possible,
so it gets a layer split of its own rather than one level covering it:

- The reload-while-offline flow is an e2e spec run against a **production build** (`vite preview`),
  Chromium only. `vite dev` never registers a service worker, so the step it exists to cover,
  reloading mid-match with the network down, cannot run under it.
- The same project covers the read side: with the network down, the roster and the match list have
  to render from the persisted query cache rather than from a request that cannot complete.
- The drain engine (replaying the offline outbox back into requests) is unit-tested against the
  generated Zod schemas rather than hand-rolled fixtures, for the reason § Contract checks against
  the API gives.
- `navigator.locks` is stubbed in `test-setup.ts` for everything that only needs a lock to exist;
  the real Locks API is exercised once, by a two-tab e2e spec.
- Behaviour specific to an installed iOS PWA stays a manual pass before a demo: nothing in CI runs
  on an installed PWA on real iOS.

#### A live API by default

Specs run against a real API, and `page.route` mocking is reserved for failure paths a healthy
backend cannot be asked to produce on demand. A mocked route is a hand-written copy of the API, free
to drift for the reason § Contract checks against the API gives. Where one is unavoidable, the
mocked body has to match the shape the OpenAPI spec publishes: FastAPI's 422 carries `detail` as an
array of objects rather than a string, and a mock that says otherwise is testing a response the API
never sends.

What makes the real flows runnable is configuration, applied by the boot script and by nothing
deployed:

- A database of its own, dropped and recreated per run, so a run never starts from what the last one
  left behind.
- An email sender that appends each message to a file instead of delivering it, so a spec can read
  the code the sign-up flow emails and carry the journey on.
- Rate limits scaled up, since browser projects signing in side by side outrun budgets sized for one
  coach on one phone.

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
coverage figure. `apps/api` is kept at 100% statement and branch coverage. `apps/web` reports the
same figures with no such target, since a generated file can sit far below one while still being
exercised through what imports it.

### What the tooling counts that we didn't write

Two build-time transforms put code into the web app's modules that no test can reach, and coverage
counts it against us unless it is turned off:

- The router plugin appends an `import.meta.hot` block to every file in `src/routes/`, because it
  suppresses that only for a production build and Vitest is not one. `import.meta.hot` is undefined
  under `vitest run`, so the block is inert and permanently uncovered. `codeSplittingOptions.addHmr`
  in `vite.config.ts` turns it off for the test run alone, which is what lets a route shell report
  the two or three statements it actually contains.
- A module of nothing but types is erased before runtime, so it never enters the module graph and
  reports as 0% forever. Those are excluded by path rather than counted.

Neither is a lever to reach for when a number looks low. The test is whether a line could run at
all: exclude only what the tooling introduced or the compiler deletes, never source we chose not to
cover.

### Coverage doesn't prove a test can fail

A percentage says a line ran, not that the assertion wrapped around it would catch a real
regression. A handful of tests are checked by mutation instead: break the thing under test on
purpose (stub a migration's `downgrade()` to `pass`, add a column the model doesn't know about) and
confirm the test meant to catch that does. This runs by hand where coverage alone can't justify a
test's existence: a guard whose branch coverage doesn't move is still worth keeping if disabling the
guard breaks it.

### Timing on a shared runner

Several CI jobs run at once on one machine, and Vitest sizes its worker pool from the cores it can
see rather than the share it gets, so concurrent jobs together ask for a multiple of the CPU that
exists. Every test budget is wall-clock, so the same work takes more of each one under that load and
the tightest expires first: a render that resolves in half a second on an idle machine can take ten
times longer.

Widening a budget only moves the next failure, so two things are done instead:

- **Await asynchronous work rather than polling for its result.** A `findBy*` or `waitFor` query has
  its own budget (`asyncUtilTimeout` in `src/test-setup.ts`), well below the whole-test one, so
  anything left inside a poll breaks first. Where the framework exposes a promise for that work, as
  the router does for resolving a route, awaiting it moves the wait to the wider budget and leaves
  the query asserting on a result already in the DOM.
- **Run the heaviest suite one job at a time.** Two copies sharing the cores each take about twice
  as long, so serializing them across pipelines (GitLab's `resource_group`, which admits one job of
  a named group at a time) finishes both at about the same moment. This removes the worst offender's
  second copy, not the contention itself: the other jobs in a pipeline still share the machine.

Neither reaches a budget that was never the suite's own: a library default sitting well below the
configured figure is the one that expires first, so a poll with no promise to await states its
budget at the call site. Capping a job's own worker count is not the lever it looks like either,
since a pool with fewer runnable processes gets a smaller share of a contended machine: it lengthens
the job without shortening any test.

## Regression testing

The full suite (unit, integration, and e2e) runs on every push via CI, so a change that breaks
previously-passing behaviour anywhere in the app fails the pipeline before it can merge. A test is
only removed when the behaviour it covers is intentionally removed — never to make a failing suite
pass. If a bug slips through, the fix ships alongside a test that reproduces it, so the same
regression can't recur silently.
