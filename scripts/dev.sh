#!/usr/bin/env bash
# Start local dev: Postgres (Docker Compose), the web app, and the API, as per README.md.
# Validates that required tools are installed and meet the versions pinned in README.md
# before starting anything.
#
# The steps it runs are plain package-manager and docker commands, so their own output is
# what you see on a normal run. What this script adds is a diagnosis when one of them
# fails: the handful of failures that actually happen here — Docker not running, a port
# already taken, a database stamped at a migration this branch does not have — say what is
# wrong in a sentence and name the command that fixes it, rather than leaving you to infer
# it from a bind error or an Alembic traceback. Anything unrecognised still shows the raw
# output, plus the command to re-run that step on its own.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Diagnosis messages come in pairs: one line saying what is wrong in plain language, one
# naming the command that fixes it. Hence a list of lines rather than one string — the
# caller writes the pair, and this only handles the stderr-and-exit part.
die() {
  printf '%s\n' "$@" >&2
  exit 1
}

# Fails if $2 (installed version) is older than $3 (required minimum), per tool $1.
require_min_version() {
  local tool="$1" installed="$2" required="$3"
  if [[ "$(printf '%s\n%s\n' "$required" "$installed" | sort -V | head -n1)" != "$required" ]]; then
    die "error: $tool $installed found, but >= $required is required (see README.md)"
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  die 'error: docker is not installed (see README.md prerequisites)'
fi
if ! docker compose version >/dev/null 2>&1; then
  die 'error: docker compose v2 is not available (see README.md prerequisites)'
fi
# Postgres exists only as a Compose service, so a daemon that is not running fails every
# step below — and the check above passes either way, since the docker CLI is installed
# whether or not the daemon it talks to is up. The permission-denied variant is worth
# splitting out: it looks identical to a stopped daemon but is fixed by a group change and
# a new login shell, not by starting anything, which is a dead end people lose time in.
if ! docker_status="$(docker info 2>&1)"; then
  if [[ "$docker_status" == *"permission denied"* ]]; then
    die 'Docker is running, but this user is not allowed to use its socket.' \
      'Add yourself to the docker group: sudo usermod -aG docker "$USER"' \
      'Then start a new login shell (or, for this shell only: newgrp docker).'
  fi
  die 'Docker is not running, and local dev runs Postgres as a Compose service.' \
    'Start Docker Desktop, or run: sudo systemctl start docker'
fi

if ! command -v node >/dev/null 2>&1; then
  die 'error: node is not installed (see README.md prerequisites)'
fi
require_min_version node "$(node --version | sed 's/^v//')" 22.13

if ! command -v pnpm >/dev/null 2>&1; then
  die 'error: pnpm is not installed (see README.md prerequisites)'
fi
require_min_version pnpm "$(pnpm --version)" 11.18.0

if ! command -v uv >/dev/null 2>&1; then
  die 'error: uv is not installed (see README.md prerequisites)'
fi
require_min_version uv "$(uv --version | awk '{print $2}')" 0.11

# `pnpm dev` ultimately execs apps/web's own vite binary, and without an install that
# surfaces as "vite: not found" from a shell three processes down, naming neither this repo
# nor the fix. Test for the binary rather than for node_modules/, so an interrupted install
# is caught too. Nothing checks the API's Python dependencies: `uv run` syncs the project
# environment itself, so there is no uninstalled state to detect.
if [[ ! -x "$repo_root/apps/web/node_modules/.bin/vite" ]]; then
  die 'The web app dependencies are not installed.' \
    'Run this from the repo root: pnpm install'
fi

# The API is started in the background further down, so if port 8000 is already taken its
# bind error scrolls past while pnpm dev keeps running: the session looks healthy and every
# request from the web app fails against nothing. The usual culprit is an API left behind by
# an earlier run in another terminal. A /dev/tcp connect is the cheapest probe that needs no
# extra tool, and a closed loopback port refuses immediately, so there is nothing to time
# out. Checked here so this fails before anything has started, not after a migration.
if (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null; then
  die 'Something is already listening on port 8000, which is where the API needs to run.' \
    'Find it with: ss -ltnp "sport = :8000" — then stop it and re-run this script.'
fi

work="$(mktemp -d)"
api_pid=""
interrupted=0

# Ctrl+C is how a dev session normally ends, but pnpm prints "Command failed with signal
# SIGINT" and "[ELIFECYCLE] Command failed." on the way out, which reads like a crash at the
# moment you did something completely normal. Those lines cannot be suppressed, so the point
# of this is to make the script's own last line unambiguous. It has to be a flag rather than
# a check for status 130 in the trap below: when the foreground child is the one signalled,
# bash does not leave 130 in $? — it re-raises the signal and the trap sees 0.
trap 'interrupted=1' INT

# One EXIT trap for the whole script, installed before anything starts and owning both the
# captured logs and the backgrounded API, so a failure at any point leaks neither. Only the
# API is killed: pnpm dev runs in the foreground and takes the terminal's SIGINT directly,
# and this covers the paths where it does not — a die() below, or pnpm dev exiting on its own.
cleanup() {
  # Both are allowed to fail without taking the rest of this function with them: the API may
  # already be gone, and wait reports the signal it died from, either of which would abort
  # the trap under errexit and skip the cleanup below.
  if [[ -n "$api_pid" ]]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
  if ((interrupted)); then
    printf 'dev servers stopped.\n'
  fi
}
trap cleanup EXIT

cd "$repo_root"
# Piped through tee rather than captured silently: the first run pulls the postgres:18
# image, and a minute of no output is indistinguishable from a hang. The log is re-read only
# to add what compose does not say — compose reports the failure at Docker's level, and
# these messages translate it into what it means for this project, plus the command to run.
log="$work/compose.log"
if ! docker compose up -d --wait 2>&1 | tee "$log"; then
  if grep -qEi 'address already in use|port is already allocated|failed to bind host port' "$log"; then
    # Compose derives its project name from the directory it runs in, so from a linked
    # worktree this just tried to start a *second* Postgres alongside the main checkout's.
    # That is indistinguishable from a system Postgres owning the port, and has a completely
    # different fix, so rule it out before blaming an install that may not exist.
    if [[ "$(git -C "$repo_root" rev-parse --git-dir 2>/dev/null)" \
      != "$(git -C "$repo_root" rev-parse --git-common-dir 2>/dev/null)" ]]; then
      die 'Port 5432 is taken, and this is a git worktree: Compose used a project name of its' \
        'own here and tried to start a second Postgres beside the main checkout'"'"'s.' \
        'Use the Postgres already running from the main checkout rather than starting one here.'
    fi
    die 'Port 5432 is already taken by another Postgres, so the Compose one cannot bind it.' \
      'Usually a system install: sudo systemctl stop postgresql' \
      'To see what owns it: sudo ss -ltnp "sport = :5432"'
  fi
  if grep -qEi 'is unhealthy|dependency failed to start' "$log"; then
    die 'Postgres started but never passed its healthcheck, so migrations cannot run against it.' \
      'See why with: docker compose logs postgres' \
      'A data volume left over from an older Postgres major is the usual cause; reset it with:' \
      '  docker compose down -v && docker compose up -d --wait   (this deletes local dev data)'
  fi
  die 'Starting the Compose Postgres failed for a reason this script does not recognise; its output is above.' \
    'Try it on its own from the repo root: docker compose up -d --wait'
fi

cd "$repo_root/apps/api"
# Same tee, for the same reason: the first uv run in a fresh clone syncs the API's
# dependencies, which is slow enough to want live progress. The two cases below are the ones
# whose raw output points at the wrong thing — both blame a migration file when what has
# actually gone wrong is the state of the database.
log="$work/alembic.log"
if ! uv run alembic upgrade head 2>&1 | tee "$log"; then
  if grep -q "Can't locate revision" "$log"; then
    die 'The database is stamped at a migration that does not exist on this branch (typical after switching branch or worktree).' \
      'See what it is stamped at with: uv run alembic current' \
      'Either switch back to the branch that has that revision and run: uv run alembic downgrade -1' \
      'or discard the local data: docker compose down -v && docker compose up -d --wait'
  fi
  # Deliberately broad, and deliberately last of the two: "already exists" would also match
  # inside the message above.
  if grep -qEi 'DuplicateTable|DuplicateColumn|UndefinedTable|UndefinedColumn|already exists' "$log"; then
    die 'A migration failed because the schema is not what it expected — database and migrations have drifted apart.' \
      'For local dev data the quickest fix is a clean database, then re-run this script:' \
      '  docker compose down -v && docker compose up -d --wait'
  fi
  die 'Applying migrations failed for a reason this script does not recognise; alembic output is above.' \
    'Run it on its own to iterate: cd apps/api && uv run alembic upgrade head'
fi

uv run fastapi dev src/matchpoint_api/main.py &
api_pid=$!

# The API runs in the background, so on its own nothing notices it exiting during startup:
# pnpm dev would take over the terminal and the session would look fine with a dead API
# behind it. One short wait plus a signal-0 probe catches that — bash reaps the child as soon
# as it exits, so kill -0 fails once it is gone. Nothing watches it after this point, and
# that is a decision rather than an oversight: fastapi dev's reloader survives a later import
# error by printing the traceback into this same terminal and waiting for the next save.
sleep 2
if ! kill -0 "$api_pid" 2>/dev/null; then
  die 'The API exited immediately after starting; its own output is above.' \
    'Run it alone to see the failure without the other servers in the way:' \
    '  cd apps/api && uv run fastapi dev src/matchpoint_api/main.py'
fi

cd "$repo_root"
pnpm dev
