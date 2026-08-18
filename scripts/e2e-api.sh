#!/usr/bin/env bash
# Start the API that the Playwright suite runs against, on a database of its own.
#
# Playwright starts this itself (apps/web/playwright.config.ts) alongside the Vite dev
# server, whose /api proxy points at it. The suite drives the real sign-up and sign-in
# flows, so the settings below are what make that possible without a provider, a breach
# corpus, or limits sized for the internet standing in the way. Every one of them is a
# lie anywhere deployed, which is why they are set here rather than in apps/api/.env.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Its own database, dropped and recreated per run, for the reason pytest's is: a suite
# that starts from whatever the last run left behind is a suite whose failures depend on
# what you ran yesterday. CI points this at its Postgres service container.
export MATCHPOINT_DATABASE_URL="${MATCHPOINT_DATABASE_URL:-postgresql+psycopg://matchpoint:matchpoint@localhost:5432/matchpoint_e2e}"

# Where verify codes go, and where e2e/mail.ts reads them back out of (mail.py). Emptied
# rather than appended to, so a spec cannot pick up a code an earlier run left. Fixed
# rather than overridable, since the reader names the same path and cannot follow it.
export MATCHPOINT_EMAIL_SENDER=file
export MATCHPOINT_EMAIL_FILE="$repo_root/apps/web/e2e/.mail.jsonl"
: >"$MATCHPOINT_EMAIL_FILE"

# The corpus lookup is a request to Have I Been Pwned per password chosen, which a test
# run should neither depend on nor spend.
export MATCHPOINT_BREACH_CHECKER=allow_all

# The suite is served over plain http://localhost, which WebKit does not count as a
# secure context: a Secure session cookie would be dropped and every signed-in spec
# would fail as signed out. Without the flag the cookie loses its __Host- prefix too,
# which auth.py already handles.
export MATCHPOINT_SESSION_COOKIE_SECURE=false

# Three browser projects signing up and signing in in parallel, and again on a retry,
# outrun limits sized for one coach on one phone. Wide enough that no spec has to think
# about the budget, and it only ever loosens (config.py).
export MATCHPOINT_RATE_LIMIT_SCALE=100

cd "$repo_root/apps/api"

# The database is created from Python rather than psql, which is not installed anywhere
# this runs: locally Postgres is a container, and in CI it is a service container.
uv run python - <<'PY'
import os
import time

from sqlalchemy import create_engine, make_url, text
from sqlalchemy.exc import OperationalError

E2E_DATABASE = "matchpoint_e2e"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
ALLOW_NONLOCAL_ENV = "MATCHPOINT_TEST_ALLOW_NONLOCAL_DB"

url = make_url(os.environ["MATCHPOINT_DATABASE_URL"])
# Checked rather than substituted in, because the name below is interpolated into DDL
# and because a URL naming any other database is one this would drop.
if url.database != E2E_DATABASE:
    raise SystemExit(f"MATCHPOINT_DATABASE_URL must name the {E2E_DATABASE} database")
# The name alone still leaves which server, so conftest's guard applies here too: this
# drops a database, and an inherited URL can point anywhere. CI's Postgres is a service
# container reachable only at an alias, hence the waiver rather than a flat refusal.
if url.host not in LOCAL_HOSTS and os.environ.get(ALLOW_NONLOCAL_ENV) != "1":
    raise SystemExit(
        f"Refusing to recreate {E2E_DATABASE} on non-local host {url.host!r}. "
        "Point MATCHPOINT_DATABASE_URL at the local Compose Postgres, or set "
        f"{ALLOW_NONLOCAL_ENV}=1 if the target is genuinely disposable."
    )

engine = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
# CI starts the Postgres service alongside the job rather than before it, so the first
# connection can beat the server to being ready.
deadline = time.monotonic() + 30
while True:
    try:
        connection = engine.connect()
        break
    except OperationalError:
        if time.monotonic() >= deadline:
            raise
        time.sleep(1)
with connection:
    # FORCE for conftest's reason: a psql or GUI session left open on it otherwise takes
    # the whole run down.
    connection.execute(text(f"DROP DATABASE IF EXISTS {E2E_DATABASE} WITH (FORCE)"))
    connection.execute(text(f"CREATE DATABASE {E2E_DATABASE}"))
engine.dispose()
PY

uv run alembic upgrade head

# 127.0.0.1 rather than `fastapi run`'s default of every interface: this is a disposable
# API with its limits turned down, and nothing outside this machine should reach it.
exec uv run fastapi run --host 127.0.0.1 --port 8000 src/matchpoint_api/main.py
