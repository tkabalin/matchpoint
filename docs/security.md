# Security

Cross-cutting security policy. The mechanisms themselves (Argon2id parameters, opaque session
tokens, the rate limiter, transactional email) are documented in [tech-stack.md](tech-stack.md);
this page records the policy that spans them.

## Account enumeration

**The risk.** Whether an email address has an account here tells a prober that a given person is a
coach on this platform, and narrows a credential-stuffing run from the address space to the
membership.

**The policy.** Every endpoint that takes an email from an unauthenticated caller answers known and
unknown addresses identically: same status code, same body, same rate-limit behaviour. New
authentication endpoints are built to this policy.

**The one exception: sign-up.** The sign-up entry point answers "Email already registered" openly.

- A form that cannot say "you already have an account, sign in instead" tests badly, and
  low-friction setup is a priority of the brief.
- The cost is metered rather than closed: the per-email rate limit charges a probe of a registered
  address exactly as it charges a code request.

**How each path holds it:**

- **Login:** one message for an unknown email and a wrong password; a dummy Argon2 verification, so
  response time does not answer what the body refuses to; a wrong-guess budget keyed on the
  submitted address whether or not an account lives there.
- **Password reset:** a uniform 202 whether or not the address holds an account.
- **Code redemption** (sign-up verification and reset codes): every failure collapses into one
  response.

**Accepted residual channels.** In the reset flow, a request for a registered address takes
measurably longer (it stores a code and sends an email), and a send failure answers 502 only for a
registered address. Both reveal nothing the sign-up entry does not already answer openly.

## Password storage

Argon2id via `argon2-cffi`, with parameters tuned for the deployment target rather than taken as
library defaults. `time_cost=3`, `memory_cost=64 MiB`, `parallelism=1`, with a semaphore capping
concurrent hashes at two. The arithmetic: each hash allocates 64 MiB, and 40 default worker threads
each doing so would exceed the API container's 512 MiB cgroup limit and trigger an OOM kill.
`parallelism=1` because the VPS has one vCPU, so extra Argon2 lanes cannot actually run in parallel.
The parameters and reasoning are recorded in `security.py`.

Passwords are NFKC-normalised before hashing or verification. A composable character (e.g. e-acute)
has more than one valid encoding depending on platform and input method; hashing raw bytes would
silently lock out a coach who enrolled from one keyboard and signs in from another. NIST SP 800-63B
recommends NFKC.

A successful login checks `needs_rehash()` and re-hashes when the stored hash uses stale parameters.
Login is the one moment where both the plaintext and a database session are available, so no offline
migration script is needed.

## Session management

A login mints a 256-bit random token, stores only its SHA-256 in a `coach_sessions` row, and sets
the token in an HttpOnly, SameSite=Lax cookie. Deleting the row is a complete revocation. A JWT is
stateless until revocation is needed, at which point the denylist is the sessions table by another
name, and the SPA would have to hold the token where JavaScript (and therefore XSS) can reach it.

**SHA-256, not Argon2, for the stored token.** Password hashing is expensive because passwords are
guessable; a 256-bit random token is not. The digest's only job is to make a stolen database copy
useless, and it runs on every authenticated request, where Argon2 would be a self-inflicted
performance penalty.

**`__Host-` cookie prefix.** The site is a subdomain sharing an apex. Without the prefix, a sibling
subdomain could set a Domain-scoped cookie of the same name that the browser would send alongside
the real one, enabling session fixation. The `__Host-` prefix forces Secure, `Path=/`, and no Domain
attribute, closing that vector. Conditional on the Secure flag so plain-HTTP local dev still works.

**Renewal from the halfway mark.** Sessions are long-lived (30 days) because the app must survive a
whole match offline, and an active coach who opens the app keeps their login alive indefinitely.
Only abandoned sessions reach expiry.

**Probabilistic garbage collection.** One in 50 authenticated requests sweeps all expired sessions.
Abandoned sessions (closed tabs, re-logins from other devices) are never presented again, so
per-request cleanup cannot reach them. This keeps the table bounded without a cron job.

**Password reset invalidates all sessions.** The purpose of a reset is that someone else may hold
the old credential; leaving their sessions alive would defeat it.

**Changing a password re-authenticates.** `POST /auth/change-password` demands the current password
rather than trusting the session: a cookie proves this browser was signed in once, not that whoever
holds it now knows the password, so without the check a stolen session is a permanent takeover. The
change then ends every session and deletes any live reset code, both being credentials the old
password left standing. The presented session is not spared: revocation matches on a token's hash,
so a thief holding a copy of that cookie sits on the same row. The device that proved the password
is handed a fresh session instead, so it stays signed in without keeping the old token.

## Cross-site request forgery

`SameSite=Lax` stops cross-site writes from carrying the cookie, but treats every host under the
same registrable domain as same-site. The app is served from a subdomain of a shared personal
domain, so a sibling host's write would arrive with the session cookie attached.

**Origin check middleware.** Every non-safe request (not GET/HEAD/OPTIONS) is refused with 403
unless its `Origin` header matches the request's `Host`. The expected origin is derived from `Host`,
not configured, so dev, tests and production need no value of their own. A missing or unparseable
`Origin` is refused. The middleware sits outermost, so a refused request reads no session and spends
no rate-limit token.

## Rate limiting

Token buckets per key in process memory, with three tiers: per-IP, per-account, and per-endpoint.

**Token buckets over fixed windows.** What parks the threadpool is a burst, and a fixed window
admits its whole allowance in one instant (and twice that straddling a boundary). A bucket's burst
parameter is a hard cap on the instantaneous queue.

**In-process memory, not an external store.** There is one API container, so there is no second
process to share state with. A deploy emptying the buckets grants a brief grace period, not a
correctness bug. Postgres would put a write on the hot path of the flood being shed; Redis would be
new infrastructure for club-scale traffic.

**Wrong-guess budget, not arrival counting.** Login's per-account tier charges only after a failed
password verification, never on a correct password. Counting arrivals would mean anyone who knows a
coach's email (which sign-up's 409 discloses) could spend each refilling token and keep the coach
locked out indefinitely. By charging only wrong guesses, a correct password is never refused.

**Atomic multi-tier check.** When a request is counted against multiple tiers, all are checked
before any is charged. If any refuses, nothing is spent. The refusal uses the tier furthest from a
token, so the client's `Retry-After` is honest across tiers.

## Request size limits

Request bodies are capped at 1 MB, enforced twice: by Caddy on the public path and by
`body_limit.py` inside the app (covering local dev and the direct-container path). Bodies without a
`Content-Length` are counted as they stream, so the header cannot be omitted to bypass the limit.

Without a cap, a single request could claim enough memory to crash the container (out-of-memory
kill). 1 MB is roughly ten times the largest legitimate payload (a full match's batch of points),
leaving room for future fields without silently breaking.

## OTP codes

Six-digit numeric codes, SHA-256-stored, with a per-row attempt cap and a ten-minute expiry.

**Numeric for autofill.** Six digits earn `autocomplete="one-time-code"` autofill on iOS and
Android, directly serving the brief's low-friction sign-up goal.

**SHA-256, not Argon2.** A six-digit code is ~20 bits: GPU lanes sweep the keyspace in minutes
regardless of the hash function, so Argon2 would add hashing-slot contention for no practical
resistance. The digest keeps the plaintext out of a database copy, and the row's attempt cap is what
actually bounds guessing.

**Attempt cap in the database row, not rate-limiter memory.** Rate-limiter counters reset on deploy;
the database row's budget survives. Five wrong guesses and the row is deleted.

**`compare_digest` for verification.** The OTP row is looked up by email and the hash comparison
happens in Python. A non-constant-time comparison would leak the hash value character by character.

## Email verification

`POST /coaches` requires a valid, unexpired verification cookie matching the submitted email.
Consuming the verification token is atomic with the account INSERT (a single
`DELETE ... WHERE ... RETURNING`), so single-use needs no lock and expiry has no TOCTOU window.
Without this, anyone could create an account for any email address.

## Secret redaction in validation errors

FastAPI's default 422 handler echoes the submitted body in `detail[].input`. A rejected sign-up
would reflect the coach's chosen password into browser devtools, proxy logs, and error-reporting
services. A global exception handler recursively redacts `password`, `otp`, and `new_password`
fields from the echoed input. A test fails if any schema adds a `SecretStr` field not listed in the
redaction set.

`SecretStr` alone is insufficient: it handles reprs and tracebacks, not FastAPI's error body.

## Authorisation boundaries

**404, not 403, for another coach's resources.** A request for a player or match belonging to
another coach returns 404. A 403 would confirm the row exists, which is the same enumeration concern
as the authentication design above.

**No coach list endpoint.** No route returns a coach other than the caller's own. A list route would
be an open dump of every coach's email address. Pinned by a test asserting `GET /coaches`
returns 404.

## Server-side request forgery

**No caller-named host is ever reached.** The API's only outbound connections are to Resend (URL
fixed as a module constant in `mail.py`, pinned by a test) and Postgres (DSN from the environment).
Neither takes a hostname or path from a request. Caddy's upstream is likewise fixed in the
Caddyfile. `EmailStr` validates syntax only (`check_deliverability=False`), and OTP emails carry a
code, not a link, so no submitted value becomes a network destination.

**Starlette's trailing-slash redirect is proxy-contained.** `redirect_slashes` builds its 307
`Location` from the `Host` header, but Caddy's site block matches one hostname, so a forged `Host`
never reaches the API. Documented rather than disabled because turning it off would 404 every
trailing-slash request.

**httpx does not follow redirects by default.** `mail.py` inherits this default, so a provider
answering 3xx fails the send rather than hopping to a new destination.

## Infrastructure

**Single-origin architecture.** Caddy serves the SPA and reverse-proxies `/api/*` from one origin.
Same-origin means no CORS configuration, no `SameSite=None` cookies, and the HttpOnly, SameSite=Lax
session cookie works without cross-origin headers.

**Firewall.** UFW on the VPS allows inbound 80/443 only from Cloudflare's published IP ranges.
Without this, Cloudflare's origin-IP-hiding is undermined by direct connections.

**Container hardening.** The API container runs as an unprivileged user with a root-owned `/app`.
All containers get `cap_drop: [ALL]` (Caddy gets `cap_add: [NET_BIND_SERVICE]`) and
`no-new-privileges`. A full non-root Caddy was rejected because the origin private key must be
readable regardless, and remapping port 80 couples three files for no gain at this threat level.

**Deploy secrets.** Neither `POSTGRES_PASSWORD` nor any signing key is stored in CI variables. The
database password lives only on the VPS, since CI builds images and hands the VPS a tag but never
talks to Postgres. `deploy.sh` writes `.env` to a temp file with mode 0600 before an atomic rename.

## Security headers

**Split.** Caddy sets the app shell's headers (`infra/prod/Caddyfile`); API responses carry their
own from middleware (`headers.py`). A header set only at the proxy is absent whenever the proxy is
not in front of the API, and the middleware's set is assertable in tests.

**Content-Security-Policy.** The shell's policy is same-origin (`default-src 'self'`), which holds
because the built app loads nothing external: no CDN scripts, no fonts, no analytics, and no inline
script or style tags. API responses get `default-src 'none'`, since JSON should never execute,
render, or be framed. The exception is Swagger UI, kept available in production and served a relaxed
policy of its own admitting its CDN assets and inline bootstrap; the relaxation is scoped to that
one HTML page, so no data response ever inherits it. ReDoc is disabled rather than granted a second,
larger exemption.

**HSTS.** `max-age=31536000; includeSubDomains`, set at the origin and passed through by Cloudflare.
A year immediately, not a ramp: the domain sits behind Cloudflare with TLS permanently on, so there
is no plain-HTTP future to be locked out of. No preload, which commits the registrable domain, and
the app lives on a subdomain of one the project does not control.

**The rest.** `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` everywhere (a
private coaching tool has no reason to advertise its URLs off-site), and framing forbidden via both
`frame-ancestors 'none'` and the legacy `X-Frame-Options: DENY`. No `Permissions-Policy` is set: the
defaults already gate powerful APIs to same-origin, and the capture screen's Screen Wake Lock must
stay available.

## Supply chain

pnpm's `minimumReleaseAge` rejects packages published in the last day, blunting the window for
compromised-release attacks. pnpm also skips install scripts for non-approved dependencies by
default.
