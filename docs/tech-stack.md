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
| Server state      | TanStack Query                             |
| Offline outbox    | _TBD -- TanStack Query mutations or Dexie_ |
| Package manager   | pnpm 11.18 workspace                       |
| Lint / format     | ESLint 10 + Prettier 3                     |
| Type checking     | tsc                                        |
| Tests             | Vitest 4 + Testing Library 16 + Playwright |

### Rationale

**React + Vite SPA.** A Single Page Application (SPA) loads once and handles all navigation in the
browser without full page reloads from the server. This matters here because a Progressive Web App
(PWA) -- a web app that can be installed to the home screen and work offline -- boots from a cached
app shell, which is inherently SPA behaviour. Server-Side Rendering (SSR), where the server
generates each page's HTML on request, provides nothing for an app that must function without a
server connection. `vite-plugin-pwa` is the most mature PWA tooling in the React ecosystem. No Node
server to run -- the built app is static files behind a reverse proxy, pairing cleanly with a Python
API on a cheap VPS. Alternatives considered: Next.js (brings App Router/RSC concepts and a Node
runtime we don't need; actively fights the offline app-shell model unless used as a static export,
at which point it's Vite with extra steps).

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

## Backend

| Category         | Choice                         |
| ---------------- | ------------------------------ |
| Language         | Python 3.12                    |
| API framework    | FastAPI 0.141 + Pydantic 2     |
| ORM              | SQLAlchemy 2 (sync)            |
| Migrations       | Alembic                        |
| Package manager  | uv                             |
| Lint / format    | Ruff 0.16                      |
| Type checking    | Pyright                        |
| Password hashing | Argon2id (argon2-cffi 25)      |
| Sessions         | Opaque tokens, HttpOnly cookie |
| Tests            | pytest 9                       |

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

**Argon2id via argon2-cffi.** OWASP's first choice for storing new passwords, and argon2-cffi is the
reference binding rather than a wrapper over one. Its parameters are set explicitly for the hardware
in `docs/infrastructure.md` rather than taken as shipped, because the defaults assume a machine we
do not have: Argon2's memory cost is allocated per concurrent hash and routes that touch the
database run on a thread pool, so the per-hash figure multiplies, and a single core cannot use more
than one of Argon2's parallel lanes. Bounding how many hashes run at once is what keeps the
recommended memory cost affordable inside the api container's memory limit, and the arithmetic is
recorded in `security.py` so that whoever changes that limit knows which figures to redo.
Alternatives considered: `pwdlib[argon2]` (what FastAPI's docs now use, but a wrapper whose value is
migrating between algorithms we have no plan to migrate between, and pre-1.0 -- the same objection
this doc makes to SQLModel); `bcrypt` (silently truncates at 72 bytes, and no memory-hardness);
stdlib `hashlib.scrypt` (zero dependencies, at the cost of hand-writing salt generation, encoding
and constant-time comparison); `passlib` (unmaintained since 2020).

**Opaque session tokens over JWTs.** A login mints a random 256-bit token, stores its SHA-256 in a
`coach_sessions` row and sets the token in an HttpOnly, SameSite=Lax cookie, `__Host-` prefixed so
that no sibling name under the apex we deploy under can shadow it; deleting the row is a complete
revocation. The offline-first requirement is what decides this: capture must survive a whole match
with no connection, so the credential has to be long-lived — it is renewed on use from the halfway
mark of its life, so only abandoned logins expire — and a long-lived credential is only defensible
when the server can end it early. HttpOnly keeps the token where XSS cannot reach, and Caddy serves
the SPA and the API from one origin, so no CORS or cross-site cookie design arises. The cost is a
table and one indexed lookup per authenticated request. Alternatives considered: JWT bearer tokens
(FastAPI's documented path and stateless, but revocation then needs a denylist — the sessions table
wearing another name — and the SPA would have to hold the token somewhere JavaScript can read, which
is exactly where XSS shops).

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
