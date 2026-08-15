# Tech Stack

## Selection criteria

Choices were evaluated against four criteria:

1. **Boring and well-trodden** -- large tutorial/StackOverflow/LLM training corpus. AI agents are
   dramatically more productive on mainstream stacks, and well-established tools have fewer
   undocumented edge cases to stumble into.
2. **Type-safety end-to-end** -- compile-time errors catch mistakes early, and give AI agents a
   tight feedback loop to iterate against.
3. **Team skills** -- Python-leaning backend experience; everyone touching React for the first time.
4. **Time-to-value** -- the stack should let us spend hours on the interesting problems (capture UX,
   scoring engine, analytics), not on framework wrestling.

Where a choice of version exists, we default to the most widely adopted release rather than the
latest, since community support and documentation coverage peak there.

## Frontend

| Category          | Choice                                     |
| ----------------- | ------------------------------------------ |
| Language          | TypeScript 5.9                             |
| UI framework      | React 19                                   |
| Bundler           | Vite 8 (PWA via vite-plugin-pwa)           |
| CSS framework     | Tailwind CSS 4                             |
| Component library | shadcn/ui (Base UI)                        |
| Routing           | TanStack Router                            |
| API codegen       | @hey-api/openapi-ts                        |
| Schema validation | Zod 4 (generated from the spec)            |
| Server state      | TanStack Query                             |
| Offline outbox    | _TBD -- TanStack Query mutations or Dexie_ |
| Package manager   | pnpm 11.18 workspace                       |
| Lint / format     | ESLint 10 + Prettier 3                     |
| Type checking     | tsc                                        |
| Tests             | Vitest 4 + Testing Library 16 + Playwright |

### Rationale

**React + Vite SPA.** A PWA boots from a cached app shell, which is inherently SPA behaviour; SSR
provides nothing for an app that must function without a server connection. `vite-plugin-pwa` is the
most mature PWA tooling in the React ecosystem. No Node server to run -- the built app is static
files behind a reverse proxy, pairing cleanly with a Python API on a cheap VPS. Alternatives
considered: Next.js (brings App Router/RSC concepts and a Node runtime we don't need; actively
fights the offline app-shell model unless used as a static export, at which point it's Vite with
extra steps).

**PWA over native.** No app-store friction, which is critical for rapid usability-testing iterations
with the client. iOS is now genuinely workable: installed PWAs are exempt from Safari's 7-day
storage eviction, storage quota is up to ~60% of disk, and Screen Wake Lock works. Two managed
caveats: no Background Sync API (sync must flush while foregrounded) and no screen-orientation lock
(capture UI works in both orientations). Alternatives considered: React Native/Expo (second
codebase, TestFlight distribution slows testing cycles, team has no RN experience); Flutter/Dart
(same app-store distribution friction, slowing usability-testing iterations with the client).

**Tailwind CSS.** Required by shadcn/ui, which uses Tailwind utility classes for all component
styling. Beyond that dependency, Tailwind's utility-first approach works well with AI agents and
avoids the naming/scoping overhead of CSS Modules.

**shadcn/ui on Base UI.** Copy-in components give full control over styling -- essential for the
highly custom capture screen -- while the dashboard gets prebuilt components (tables, cards,
dialogs) for free. Base UI is now shadcn's default primitives layer, backed by the Radix/Floating-UI
creators. Agents handle shadcn well. Alternatives considered: shadcn on Radix (no longer the default
for new projects); hand-rolled Tailwind only (would mean rebuilding dialogs/menus/accessibility by
hand).

**TanStack Router.** The strongest type safety of the options we looked at including typed search
params (useful for dashboard filter state in shareable URLs), natural pairing with TanStack Query.
React Router v8 was the conservative alternative -- either works; TanStack won on the type-safety.

**TanStack Query.** Built-in `networkMode`/`onlineManager` for offline handling, cache persistence
to IndexedDB via `persistQueryClient`, optimistic updates. Used for server-state reads and
optimistic UI.

**@hey-api/openapi-ts.** FastAPI's auto-generated OpenAPI 3.1 spec feeds directly into typed
TypeScript client generation with a TanStack Query plugin. This is now FastAPI's own recommended
path.

**Zod, generated rather than written.** The generated types describe field names and primitive
types, and drop every constraint the spec carries beyond them: a date, a UUID and a length-bounded
string all compile down to `string`. The same generator emits Zod schemas that keep those, so a
request body can be checked against the real contract in a unit test, offline, with no server
running. Generating them is the point: a hand-written schema is a second copy of the contract, free
to drift toward whatever the code under test already does. Alternative considered: Valibot (smaller,
and the generator supports it equally; Zod is the more widely known of the two, and bundle size does
not bind on a validator used in tests and at one sync boundary).

## Backend

| Category            | Choice                         |
| ------------------- | ------------------------------ |
| Language            | Python 3.12                    |
| API framework       | FastAPI 0.141 + Pydantic 2     |
| ORM                 | SQLAlchemy 2 (sync)            |
| Migrations          | Alembic                        |
| Package manager     | uv                             |
| Lint / format       | Ruff 0.16                      |
| Type checking       | Pyright                        |
| Password hashing    | Argon2id (argon2-cffi 25)      |
| Sessions            | Opaque tokens, HttpOnly cookie |
| Rate limiting       | In-process token bucket        |
| Transactional email | Resend (HTTP API via httpx)    |
| Logging             | structlog 26                   |
| Tests               | pytest 9                       |

### Rationale

**Python + FastAPI over an all-TypeScript backend.** The offline-first requirement forces scoring
logic into the client, so the backend's jobs shrink to: auth, durable storage, sync ingestion, and
analytics queries. Python is the team's language strength and the natural home for the analytics
side (aggregation queries, potential pandas for trend computation). FastAPI is the most mainstream
Python API framework with first-class auto-OpenAPI generation, feeding the typed TS client pipeline.
Large LLM training corpus. The strongest alternative was an all-TypeScript backend: one language
everywhere, scoring engine shared via a workspace package, single toolchain. It lost on team skills
(everyone learning the backend stack from scratch during the project) and on losing Python's
analytics ergonomics.

**SQLAlchemy 2 (sync) + Alembic.** The standard pair; SQLAlchemy 2.0's unified API is well-known to
LLMs. Sync is deliberate: FastAPI runs sync routes in a threadpool, and our load is club-scale --
async adds complexity for zero benefit here while keeping a later async migration mechanical.
Alternative considered: SQLModel (still 0.0.x after five years, no API-stability guarantee; our
analytics queries would outgrow its sweet spot).

**uv + Ruff + Pyright.** The modern Python toolchain: uv for package/project management, Ruff for
lint and format (replaces multiple tools), Pyright for type checking. All are fast, well-maintained,
and LLM-friendly.

**Argon2id via argon2-cffi.** OWASP's first choice for new password storage; argon2-cffi is the
reference binding, not a wrapper. Parameters are set explicitly for the hardware in
`docs/infrastructure.md` rather than taken as shipped: Argon2's memory cost is allocated per
concurrent hash, and the api container's memory limit bounds how many can run at once. The
arithmetic is recorded in `security.py` so that whoever changes that limit knows which figures to
redo. Alternatives considered: `pwdlib[argon2]` (a wrapper whose value is algorithm migration we
don't plan, and pre-1.0); `bcrypt` (silently truncates at 72 bytes, no memory-hardness);
`hashlib.scrypt` (zero deps, but hand-rolled salt/encoding/comparison); `passlib` (unmaintained
since 2020).

**Opaque session tokens over JWTs.** A login mints a random 256-bit token, stores its SHA-256 in a
`coach_sessions` row, and sets the token in an HttpOnly, SameSite=Lax, `__Host-`-prefixed cookie;
deleting the row is complete revocation. The offline-first requirement decides this: the credential
must be long-lived (renewed on use from its half-life, so only abandoned logins expire), and a
long-lived credential is only defensible when the server can end it early. Caddy serves the SPA and
API from one origin, so no CORS or cross-site cookie design arises. Alternatives considered: JWT
bearer tokens (stateless, but revocation needs a denylist — the sessions table wearing another name
— and the SPA must hold the token where JavaScript, and therefore XSS, can read it).

**Hand-rolled in-process rate limiting.** Token buckets per key (`rate_limit.py`) bound the arrival
rate on sign-up and login, the endpoints that spend real work on unauthenticated input, and give
each signed-in coach one budget across the whole API. The limit lives in the app because it must key
on things only the app sees: the coach behind a session cookie, and on login a wrong-guess budget
keyed on the submitted email, charged only after a failed verification so the bound can't become a
lockout. A 429 declared in the OpenAPI spec is a response the generated client can type and the test
suite can exercise. Counters are process memory (single container, deploy-reset is harmless). Behind
Cloudflare, per-address limiting is fairness; a shared per-endpoint bucket provides the hard bound.
Alternatives considered: slowapi (pre-1.0, for a few dozen lines of stdlib); Redis/Postgres counters
(a stateful service to solve a multi-process problem we don't have); Caddy's rate_limit module (not
in stock Caddy, proxy can't key on accounts); Cloudflare rate-limiting rules (can't key on accounts
either, invisible to tests).

**Resend over its HTTP API.** Sign-up verification emails a six-digit code, so the API needs to send
mail. Resend is quick to work with -- domain verification is three DNS records -- and its free
tier's 3,000 messages a month is well clear of anything this project will send. HTTP rather than
SMTP because a low-cost VPS has no IP reputation to send on and port 25 is one more thing to get
blocked on; the provider owns deliverability. Senders sit behind a Protocol chosen by configuration
(`mail.py`), so a second provider is one class and one entry. Alternative considered: SMTP from the
box (reputation, port 25, more moving parts).

**structlog for logging.** Each request is logged as one JSON line carrying a request id that is
also returned on the response, so a production question is a field filter over container logs and a
reported error ties to the line it produced (`logs.py`). structlog is the standard structured
logging library for Python: mature, and its contextvars binding puts the id on every line a request
emits without threading it through call sites. The request line replaces uvicorn's access log rather
than duplicating it. Secrets stay out the way `errors.py` keeps them out of a 422: the line carries
no body, header or query value, and a processor redacts secret-named keys as a backstop.
Alternatives considered: stdlib logging with a hand-rolled JSON formatter (the same result for more
of our own plumbing); asgi-correlation-id for the request id (mature, but it would replace five
lines inside a middleware the request line needs anyway).

## Infrastructure

| Category           | Choice                            |
| ------------------ | --------------------------------- |
| Database           | PostgreSQL 18                     |
| Containers         | Docker Compose (local dev + prod) |
| Web server / proxy | Caddy 2                           |
| CI/CD              | GitLab CI                         |

### Rationale

**PostgreSQL over SQLite and MySQL.** PostgreSQL handles concurrent access cleanly (SQLite is
single-writer) and is the standard choice for production web applications. SQLite was the
lightweight alternative but its single-writer ceiling made it less appropriate for a real
application. MySQL was the other mainstream option; PostgreSQL was chosen over it based on existing
team experience. All schema lives in Alembic migrations from day one, keeping switching costs low
regardless.

**Docker Compose for local dev and prod.** Gives dev/prod parity with minimal overhead. Local dev
runs just Postgres (root `docker-compose.yml`); production runs the full stack on the VPS from
`infra/prod/compose.yml`.

**Caddy.** Serves the built SPA and reverse-proxies `/api/*` to the API from a single origin, which
removes CORS from the picture entirely. TLS is a two-line config using a Cloudflare Origin
Certificate — no ACME to break behind the Cloudflare proxy. Alternative considered: nginx (more
config boilerplate for the same outcome, and manual cert wiring either way).

**GitLab CI.** Dictated by the university's GitLab instance (`gitlab.cs.uct.ac.za`) being the
required code host for submission. The CI runner is self-hosted on an off-campus server since the
university instance does not provide shared runners. The same pipeline handles CD: images are built
on the runner, uploaded as tarballs to the project's package registry (the container registry port
is firewalled to campus-internal traffic, so off-campus machines cannot push or pull images), and
deployed to the VPS over SSH (see `infra/prod/README.md`).
