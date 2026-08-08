#!/usr/bin/env bash
# Nightly logical Postgres backup. Installed at /opt/matchpoint/backup.sh and
# run from the deploy user's crontab (see README.md). Dumps land outside the
# Docker volume: VPS snapshots cover catastrophic loss, but a logical dump is
# what restores one table after a bad migration.
set -euo pipefail
cd /opt/matchpoint

mkdir -p backups
dump="backups/matchpoint-$(date +%F).sql.gz"

# Rename into place only once the dump has succeeded. A pg_dump that fails or
# dies mid-stream still leaves a valid gzip file behind, which the retention
# rule below would count as a good backup and rotate a real one out for.
docker compose exec -T postgres pg_dump -U matchpoint matchpoint |
  gzip > "$dump.part"
mv "$dump.part" "$dump"

# Keep the newest 14 dumps.
ls -1t backups/matchpoint-*.sql.gz | tail -n +15 | xargs -r rm --
