#!/usr/bin/env bash
# Run the full check suite (web + API): format check, lint, typecheck, test — matches
# CI. Optional locally; running it before pushing catches failures early, but CI runs
# the same checks regardless.
#
# The formatters run in check mode, not write mode, so this script never touches the
# working tree — that is what makes it match CI. Use scripts/format.sh to reformat.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test

cd "$repo_root/apps/api"
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest
