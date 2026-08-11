#!/usr/bin/env bash
# Regenerate the typed TypeScript API client from the FastAPI routes.
#
# Two steps, and both belong in the same commit as the API change that prompted them:
#
#   1. apps/api/openapi.json    <- the spec, dumped from the app (no server, no database)
#   2. packages/api-client/src  <- the client, generated from that file
#
# Step 2 alone is enough if the spec is already current (`pnpm --filter
# @matchpoint/api-client run generate`) and needs only Node — but running the whole
# script is what guarantees the client matches the routes as they are now.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root/apps/api"
uv run python -m matchpoint_api.openapi

cd "$repo_root"
pnpm --filter @matchpoint/api-client run generate
