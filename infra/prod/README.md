# Production deployment

The stack runs on the `matchpoint-prod` VPS as three containers (Caddy serving the built SPA and
proxying `/api/*`, the FastAPI service, Postgres), defined by `compose.yml`. CI builds images on the
ThinkTank runner, uploads them as docker-save tarballs to the GitLab **generic package registry**
(package `images`, version = commit short SHA), then triggers `deploy.sh` on the VPS over SSH, which
downloads and `docker load`s the tarballs for that SHA. The GitLab **container registry** is not
used: its port (5050) is firewalled to campus-internal traffic, while the package registry rides the
normal HTTPS port, which both the runner and the VPS can reach. The SSH key CI holds is locked to
that one script via a forced command, so it cannot open a shell.

## One-time VPS provisioning

Done by hand as the `thomas` admin user; CI never performs these steps.

0. Install Docker Engine (the `docker` group only exists once this is done) — follow
   [Docker's official Ubuntu apt repo instructions](https://docs.docker.com/engine/install/ubuntu/),
   installing `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`.
1. Create a `deploy` user in the `docker` group (no sudo): `sudo useradd -m -G docker deploy`
2. Install this directory's files:
   - `compose.yml`, `deploy.sh`, and `backup.sh` (both scripts executable) into `/opt/matchpoint/`,
     with the directory itself and everything in it owned by `deploy`. `deploy.sh` records the
     deployed tag by writing a temp file alongside `.env` and renaming it, so a directory it can
     only read is not enough.
   - A Cloudflare **Origin Certificate** pair (Cloudflare dashboard → SSL/TLS → Origin Server) as
     `/opt/matchpoint/certs/origin.pem` and `origin.key`, owned by `root:root` with the key at mode
     `600`, and the Cloudflare SSL mode set to **Full (strict)**. The web container drops
     `CAP_DAC_OVERRIDE`, so a key owned by any other user is unreadable to Caddy and TLS will not
     load.
3. Create `/opt/matchpoint/.env` containing `POSTGRES_PASSWORD=<generated>`, mode `600` (`deploy.sh`
   manages the `IMAGE_TAG` line and preserves the mode).
4. Create a project deploy token (GitLab → Settings → Repository → Deploy tokens) scoped to
   `read_package_registry` only (not a personal access token; deploy-token scopes are fixed at
   creation, so widening one later means issuing a new token) and add it to `/opt/matchpoint/.env`
   as `DEPLOY_TOKEN=<token>` — `deploy.sh` sends it when downloading image tarballs.
5. Restrict the CI deploy key in `/home/deploy/.ssh/authorized_keys`:

   ```
   command="/opt/matchpoint/deploy.sh",no-port-forwarding,no-pty,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... matchpoint-ci
   ```

The private half of that key and the VPS host key live in the CI/CD variables `SSH_PRIVATE_KEY` and
`SSH_KNOWN_HOSTS` (both **File**-type, protected).

## Deploys and rollback

Every green pipeline on `main` deploys automatically (the `production` environment in GitLab records
the history). `deploy.sh` takes the image tag as the SSH command, so rolling back is deploying an
older SHA:

```
ssh deploy@<vps> <previous-short-sha>
```

or re-run an older pipeline's deploy job from the GitLab UI.

Rollbacks reach as far back as the package registry does — CI prunes it to the newest 10 image
packages. Rolling back to one of the newest 5 tags per image needs no download at all: `deploy.sh`
keeps that many loaded on the VPS and skips the download when the tag is already present.

Rolling back past a migration needs the schema downgraded from the newer image first — the older
image's Alembic cannot read the revision the database is stamped with. `deploy.sh` detects that and
refuses the deploy rather than failing halfway through it.

If `compose.yml`, `deploy.sh`, or the certs change, they must be re-installed on the VPS by hand —
the restricted SSH key deliberately cannot copy files.

## Database backups

`backup.sh` writes a nightly gzipped `pg_dump` to `/opt/matchpoint/backups/` — outside the Docker
volume — keeping the newest 14. VPS snapshots cover catastrophic loss; the logical dump is what
restores data after a bad migration. Install it in the `deploy` user's crontab, timed so the 02:00
VPS snapshot captures the fresh dump:

```
30 1 * * * /opt/matchpoint/backup.sh
```

## Operating the box by hand

Everything below runs **as `deploy`, from the compose project directory** — `deploy` is the account
in the `docker` group, and every `docker compose` call needs `.env` (mode `600`, owned by `deploy`)
for `IMAGE_TAG` and `POSTGRES_PASSWORD`:

```
sudo -iu deploy
cd /opt/matchpoint
```

| Task                         | Command                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Which tag is deployed        | `grep IMAGE_TAG .env`                                        |
| Deploy or roll back to a tag | `SSH_ORIGINAL_COMMAND=<short-sha> ./deploy.sh`               |
| Tags still loaded locally    | `docker images 'matchpoint/*'`                               |
| Container status             | `docker compose ps`                                          |
| Follow a service's logs      | `docker compose logs -f --tail=100 api`                      |
| Restart one service          | `docker compose restart api`                                 |
| Database shell               | `docker compose exec postgres psql -U matchpoint matchpoint` |
| Schema revision the DB is at | `docker compose run --rm api alembic current`                |
| Back up now, off the cron    | `./backup.sh`                                                |

`deploy.sh` takes its tag from `SSH_ORIGINAL_COMMAND` because CI arrives through a forced command,
so setting that variable by hand is the same entry point the pipeline uses — migration guard,
tarball download and `.env` bookkeeping included.

Restoring a dump **replaces the current database**. The dumps are plain `pg_dump` output with no
drop statements, so the schema goes first or the restore collides with the tables already there:

```
docker compose exec -T postgres psql -U matchpoint matchpoint \
  -c 'drop schema public cascade; create schema public;'
gunzip -c backups/matchpoint-<date>.sql.gz |
  docker compose exec -T postgres psql -U matchpoint matchpoint
```
