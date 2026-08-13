# CI/CD Pipeline

How a commit gets from a branch to production: what CI checks, what a merge to `main` triggers, and
the guardrails around deployment. The pipeline is defined in `.gitlab-ci.yml`; the deployment files
it drives live in `infra/prod/` (see the README there for VPS provisioning). Server and network
decisions are in [infrastructure.md](infrastructure.md).

## CI — every branch and merge request

**A pipeline runs** for every merge request and every push to `main`. A branch with no open merge
request gets one too — but once an MR exists, only the MR pipeline runs, so the same commit is never
checked twice.

| Stage | API (uv / Python)                        | Web (pnpm / Node)                               |
| ----- | ---------------------------------------- | ----------------------------------------------- |
| lint  | Ruff check, Ruff format check            | Prettier check, ESLint — both repo-wide         |
| test  | Pyright, pytest against Postgres service | tsc, Vitest; Playwright e2e in a job of its own |

Apart from e2e, these are the same non-mutating checks as `scripts/check.sh`, so a green local check
predicts a green pipeline. Everything runs on the self-hosted ThinkTank runner.

**The API tests need a database, and CI supplies one.** They run against real Postgres, never SQLite
or a mock (see [testing.md](testing.md) for why) — locally the Compose instance, in CI a service
container pinned to the same major version as `docker-compose.yml` and production. The test fixtures
refuse to recreate their scratch database on a non-local host, and a service container is one; since
its alias is the same `postgres` hostname production uses, no hostname check could tell the two
apart, so the job opts out explicitly with `MATCHPOINT_TEST_ALLOW_NONLOCAL_DB`.

**The jobs run as a graph, not in lockstep.** Each declares what it actually depends on, so the two
toolchains progress as independent chains and nothing waits on a stage boundary it has no dependency
on:

```
python-lint ─┐
             ├─▶ build-api-image ─┐
api-test ────┘                    │
                                  ├─▶ deploy ─▶ smoke
web-lint ────┐                    │
web-test ────┼─▶ build-web-image ─┘
web-e2e ─────┘
```

Every job in the left-hand column is ready the moment the pipeline starts, so the graph is a ceiling
on parallelism rather than a guarantee: the runner's job-slot count decides how many actually run at
once (see [infrastructure.md](infrastructure.md)).

Lint gates the image builds rather than the test jobs, which is the one non-obvious edge here: a job
in a graph runs as soon as its _own_ dependencies are met regardless of what else failed, so lint
has to sit upstream of the builds or a failing formatter sails through to a deploy. It costs nothing
there, since the builds wait on the tests anyway — whereas gating the tests on it would park
repo-wide Prettier in front of the browser suite.

**The build jobs' upstream edges are soft, the deploy job's are not.** Jobs drop out of a pipeline
independently, and an edge pointing at a job that was never created is a config error rather than a
skip — hence optional dependencies on the builds. Deploy's are hard on purpose: it only runs on
`main`, where both builds always run, so a soft edge could only ever let a deploy fire for a commit
whose images were never uploaded.

The `stages:` list in `.gitlab-ci.yml` still exists, but with the graph in place it orders the
pipeline view rather than acting as a barrier.

**Which of them run depends on what changed.** On `main` all of them do, always. Elsewhere each job
runs only when its own inputs are touched, so a change to one toolchain doesn't burn runner time on
the other:

- **API jobs** — anything under `apps/api/`.
- **Web lint** — anything Prettier or ESLint reads, which is much more than web source: shared
  packages, docs, Markdown anywhere in the repo, root manifests and tool configs. That breadth is
  deliberate: a formatting violation that slipped through would fail the next pipeline that did run
  one, far from the change that caused it.
- **Web typecheck, unit tests and e2e** — web app code and the manifests that describe it, and
  nothing else. A docs-only change therefore runs web lint but not the browser suite, which is the
  most expensive thing in the pipeline and cannot tell a prose edit anything.
- **Both** — a change to the pipeline definition itself.

Also on every pipeline:

- **Image builds are exercised on merge requests**: any change an image is built from — app source,
  dependencies, lockfiles, Dockerfiles — rebuilds that image without uploading it, so a broken build
  fails on the MR rather than on `main`. The two builds have separate input lists.
- **Dependency caches** — the pnpm store, uv's cache, pyright's Node download — **are keyed on
  lockfile content**, and each is pushed only by the job that owns it; the rest restore it
  read-only. The runner holds a copy per job slot, so a job can miss a cache another slot already
  has.
- **Test reports surface in the MR**: every suite emits JUnit XML, so failures appear in the
  merge-request widget rather than job logs. Coverage feeds the project badge, and a failed e2e run
  attaches its Playwright HTML report, traces included.
- **E2E runs on the Playwright image**, since it needs browsers, and stays out of `scripts/check.sh`
  so local commits don't wait on it.
- **Superseded work is cancelled**: pipelines are `interruptible`, and duplicate branch/MR pipelines
  are suppressed.

## CD — merges to `main`

A green `main` pipeline continues into three more stages:

1. **Build** — both images are built on the runner against the host Docker daemon (so the layer
   cache persists between runs), tagged with the commit short SHA, and uploaded as `docker save`
   tarballs to the project's generic package registry using the pipeline-scoped job token — no
   stored registry secret. The GitLab container registry isn't used: its port is firewalled to
   campus-internal traffic, so an off-campus runner or VPS can't reach it, while the package
   registry rides the normal HTTPS port. That choice comes with the retention problem the container
   registry would have solved: the generic registry has no cleanup policy of its own, so the
   pipeline prunes it to the newest 10 image packages itself. The runner host's own tags need the
   same treatment for the same reason a rolled VPS does — an immutable per-commit tag is never
   dangling, so nothing reclaims it — and each build bounds its image to the newest few tags, which
   is all the layer cache needs.
2. **Deploy** — the pipeline SSHes to the VPS and hands over the SHA tag. The key it holds is bound
   to a forced command, so it can run `/opt/matchpoint/deploy.sh` and nothing else; the script
   downloads and `docker load`s the tarball for that SHA (using a read-only deploy token, skipping
   the download if the tag is already loaded locally), runs Alembic migrations as a one-shot (a
   failure aborts the deploy and leaves the previous containers running), brings the stack up, and
   records the tag only once that has all worked.
3. **Verify** — the pipeline then asks production the way a browser would, over the public name and
   through Cloudflare: `/api/health` until it names the commit just deployed, then the app shell.
   `deploy.sh` returns when compose has _started_ the containers, which is a weaker claim than the
   site working, so the check polls rather than asking once. Nothing is rolled back on a failure —
   the pipeline goes red and the alert fires, and what to do about it is a person's call.

The API reports its build because the deployed image tag is passed to it as an environment variable,
which makes "did this deploy take effect" answerable from outside — a container that started while
Caddy still fronts the previous tag cannot pass. Publishing that tag is deliberate: it identifies a
build without describing one, since the repository it indexes is private.

**Deploys are automatic** on every green `main` pipeline — merging is releasing, which fits the
rapid usability-testing loop with the client. Guardrails: deploys record to the GitLab `production`
environment for history and one-click redeploys, with deploy access matching merge access (the merge
is the release decision, so gating deploy more tightly only produces failed jobs); a
`resource_group` keeps two deploys from overlapping; and the deploy job is never auto-cancelled.

**Rollback is a redeploy of an older SHA** — image tags are immutable per commit, so rolling back
means re-running an older pipeline's deploy job (or `ssh deploy@<vps> <older-sha>`), not rebuilding.
Reach is bounded by the package registry's 10-package retention; the newest 5 tags per image roll
back without a download at all, since `deploy.sh` keeps that many loaded on the VPS. Rolling back
past a migration needs the schema downgraded from the newer image first; `deploy.sh` detects that
case and refuses rather than failing halfway. Retrying a job re-runs that job alone, so a rollback
by that route is neither smoke-checked nor announced in Slack — the deploy job's own output is the
only record.

### Slack alerts

Two messages, both `main`-only, sent to an incoming webhook. Both carry the linked commit SHA and
title, whoever started the pipeline, and a colour bar for the outcome:

| Alert              | Sent when                                            |
| ------------------ | ---------------------------------------------------- |
| ✅ Deployed        | production answers as the new build — links the site |
| ❌ Pipeline failed | any job in a `main` pipeline fails, at any stage     |

The commit's author is named as well, but only when that is someone other than whoever started the
pipeline — on a merge the two differ, and the person who started it is the one around to act.

The failure alert fires for any broken `main` pipeline, not only failed deploys — a lint or test
break that never reaches deployment is exactly when a broken `main` is worth announcing.
Limitations: it can't name the specific failing job (no CI variable carries that), there is no
"deploy started" message, and branch/MR pipelines are silent. Both alert jobs drop out of the
pipeline entirely while `SLACK_WEBHOOK_URL` is unset.

## Production stack

`infra/prod/compose.yml` runs three containers on the VPS:

| Container | Role                                                                              |
| --------- | --------------------------------------------------------------------------------- |
| web       | Caddy: terminates TLS (Cloudflare origin cert), serves the built SPA, proxies API |
| api       | FastAPI under uvicorn                                                             |
| postgres  | PostgreSQL, nightly logical backups on top of VPS snapshots                       |

**One origin for SPA and API.** Caddy serves the app shell and reverse-proxies `/api/*` to the API
container, so there is no CORS configuration anywhere — removing a whole category of
works-locally-breaks-on-prod bugs. The `/api` prefix is stripped at the proxy and restored via
uvicorn's `--root-path`, keeping API route paths clean.

**Build once, in CI.** Images are built in a consistent environment and the VPS only ever loads and
runs them — the production box never builds, and a half-finished deploy can't leave it in a broken
state. Only the two application images arrive as tarballs; Postgres is pulled from Docker Hub, so
the box needs Hub reachable whenever that pin names a tag it hasn't already loaded.
