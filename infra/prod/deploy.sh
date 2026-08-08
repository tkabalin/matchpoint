#!/usr/bin/env bash
# Redeploys the stack to the image tag passed as the SSH command. Installed at
# /opt/matchpoint/deploy.sh and wired as the *forced command* for the CI deploy
# key (command="..." in authorized_keys), so this script is the only thing that
# key can run — a leaked key can redeploy the app, not open a shell.
set -euo pipefail
cd /opt/matchpoint

# With a forced command, whatever the SSH client asked to run arrives here.
tag="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$tag" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "expected a commit-SHA image tag as the SSH command" >&2
  exit 1
fi

# Compose prefers IMAGE_TAG from the environment over the one in .env, so the
# deploy runs against the new tag while .env still records what is actually
# running. It is rewritten at the end, once all of this has worked.
export IMAGE_TAG="$tag"

# Images arrive as docker-save tarballs from the GitLab generic package
# registry (the container registry port is firewalled off-campus). The
# read-only deploy token lives in .env next to POSTGRES_PASSWORD; read just
# that line rather than sourcing the whole file.
deploy_token=$(grep '^DEPLOY_TOKEN=' .env | cut -d= -f2-)
if [[ -z "$deploy_token" ]]; then
  echo "DEPLOY_TOKEN missing from .env" >&2
  exit 1
fi
for image in api web; do
  # Already present means a rollback to a previously loaded tag — skip the
  # download. docker load decompresses the gzipped tarball itself.
  if ! docker image inspect "matchpoint/$image:$tag" > /dev/null 2>&1; then
    curl -fsS -H "DEPLOY-TOKEN: $deploy_token" \
      "https://gitlab.cs.uct.ac.za/api/v4/projects/tldr%2Fmatchpoint/packages/generic/images/$tag/$image.tar.gz" \
      | docker load
  fi
done

# Rolling back to an image whose migrations predate the current schema cannot
# work — that image's Alembic has never heard of the revision the database is
# stamped with. Say so, instead of letting alembic fail with a bare traceback.
# An empty result means a first deploy, with no alembic_version table yet.
db_rev=$(docker compose exec -T postgres psql -qtAX -U matchpoint matchpoint \
  -c 'select version_num from alembic_version' 2> /dev/null || true)
if [[ -n "$db_rev" ]] && ! docker compose run --rm api alembic show "$db_rev" > /dev/null 2>&1; then
  echo "database is at revision $db_rev, which image $tag does not contain" >&2
  echo "downgrade the schema from the newer image before rolling back" >&2
  exit 1
fi

# Migrations run as a one-shot before the API rolls; a failure aborts the
# deploy loudly and leaves the previous containers running.
docker compose run --rm api alembic upgrade head
docker compose up -d

# `docker image prune` would free nothing here: every image is tagged with an
# immutable per-commit SHA, so rolling to a new tag leaves the old one tagged
# rather than dangling. Bound the local rollback window explicitly instead,
# keeping the newest 5 tags per image (docker images lists newest first). The
# deployed tag is skipped because a rollback re-deploys an old image, which can
# itself fall outside that window.
for image in api web; do
  for old in $(docker images "matchpoint/$image" --format '{{.Tag}}' | tail -n +6); do
    if [[ "$old" != "$tag" ]]; then
      docker rmi "matchpoint/$image:$old" > /dev/null 2>&1 || true
    fi
  done
done

# grep -v exits 1 only when .env holds nothing but IMAGE_TAG lines, leaving an
# empty .env.tmp — harmless, as the tag line is appended next. Any other failure
# means .env could not be read, and it must not be clobbered with a truncated
# copy: it holds POSTGRES_PASSWORD, which is not recoverable from the Postgres
# volume.
grep -v '^IMAGE_TAG=' .env > .env.tmp || [[ $? -eq 1 ]]
echo "IMAGE_TAG=$tag" >> .env.tmp
# mv carries .env.tmp's permissions onto .env, so set them before the rename.
chmod 600 .env.tmp
mv .env.tmp .env

echo "deployed $tag"
