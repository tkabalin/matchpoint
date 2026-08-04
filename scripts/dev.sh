#!/usr/bin/env bash
# Start local dev: Postgres (Docker Compose), the web app, and the API, as per README.md.
# Validates that required tools are installed and meet the versions pinned in README.md
# before starting anything.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Fails if $2 (installed version) is older than $3 (required minimum), per tool $1.
require_min_version() {
  local tool="$1" installed="$2" required="$3"
  if [[ "$(printf '%s\n%s\n' "$required" "$installed" | sort -V | head -n1)" != "$required" ]]; then
    echo "error: $tool $installed found, but >= $required is required (see README.md)" >&2
    exit 1
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is not installed (see README.md prerequisites)" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose v2 is not available (see README.md prerequisites)" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is not installed (see README.md prerequisites)" >&2
  exit 1
fi
require_min_version node "$(node --version | sed 's/^v//')" 22.13

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is not installed (see README.md prerequisites)" >&2
  exit 1
fi
require_min_version pnpm "$(pnpm --version)" 11.18.0

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is not installed (see README.md prerequisites)" >&2
  exit 1
fi
require_min_version uv "$(uv --version | awk '{print $2}')" 0.11

cd "$repo_root"
docker compose up -d --wait

cd "$repo_root/apps/api"
uv run alembic upgrade head
uv run fastapi dev src/matchpoint_api/main.py &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null; wait "$api_pid" 2>/dev/null' EXIT

cd "$repo_root"
pnpm dev
