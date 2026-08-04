#!/usr/bin/env bash
# Format web + API code in place. Run before every commit (required).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
pnpm run format

cd "$repo_root/apps/api"
uv run ruff format .
