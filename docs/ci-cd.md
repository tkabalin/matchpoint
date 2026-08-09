# CI/CD Pipeline

How a commit gets from a branch to production: what CI checks, what a merge to `main` triggers, and
the guardrails around deployment. The pipeline is defined in `.gitlab-ci.yml`; the deployment files
it drives live in `infra/prod/` (see the README there for VPS provisioning). Server and network
decisions are in [infrastructure.md](infrastructure.md).

## CI — every branch and merge request

**A pipeline runs** for every merge request and every push to `main`. A branch with no open merge
request gets one too — but once an MR exists, only the MR pipeline runs, so the same commit is never
checked twice.

| Stage | API (uv / Python)             | Web (pnpm / Node)                               |
| ----- | ----------------------------- | ----------------------------------------------- |
| lint  | Ruff check, Ruff format check | Prettier check, ESLint — both repo-wide         |
| test  | Pyright, pytest               | tsc, Vitest; Playwright e2e in a job of its own |

Apart from e2e, these are the same non-mutating checks as `scripts/check.sh`, so a green local check
predicts a green pipeline. Everything runs on the self-hosted ThinkTank runner.

**Which of them run depends on what changed.** On `main` all of them do, always. Elsewhere each
family runs only when its own inputs are touched, so a change to one toolchain doesn't burn runner
time on the other:

- **API jobs** — anything under `apps/api/`.
- **Web jobs** — anything Prettier or ESLint reads, which is much more than web source: shared
  packages, docs, Markdown anywhere in the repo, root manifests and tool configs. A docs-only change
  therefore still runs web lint. That breadth is deliberate: a formatting violation that slipped
  through would fail the next pipeline that did run one, far from the change that caused it.
- **Both** — a change to the pipeline definition itself.

Also on every pipeline:

- **Image builds are exercised on merge requests**: a change to anything an image is built from —
  app source, dependencies, lockfiles, the Dockerfiles themselves — builds both images without
  uploading them, so a broken build fails on the merge request rather than on `main`.
- **Test reports surface in the MR**: every suite emits JUnit XML, so a failing test appears in the
  merge-request widget rather than buried in job logs. Coverage output feeds the project badge, and
  a failed e2e run attaches its Playwright HTML report — traces included — as an artifact.
- **E2E runs on its own job**, on the Playwright image rather than the plain Node one, since it
  needs browsers. It is not part of `scripts/check.sh`: e2e is slow enough that it stays a CI and
  on-demand step rather than something every local commit waits on.
- **Superseded work is cancelled**: pipelines are `interruptible`, so pushing again auto-cancels the
  outdated run, and duplicate branch/MR pipelines are suppressed.

## CD — merges to `main`

A green `main` pipeline continues into two more stages:

1. **Build** — both images are built on the runner against the host Docker daemon (so the layer
   cache persists between runs), tagged with the commit short SHA, and uploaded as `docker save`
   tarballs to the project's generic package registry using the pipeline-scoped job token — no
   stored registry secret. The GitLab container registry isn't used: its port is firewalled to
   campus-internal traffic, so an off-campus runner or VPS can't reach it, while the package
   registry rides the normal HTTPS port. CI prunes the package registry to the newest 10 image
   packages.
2. **Deploy** — the pipeline SSHes to the VPS and hands over the SHA tag. The key it holds is bound
   to a forced command, so it can run `/opt/matchpoint/deploy.sh` and nothing else; the script
   downloads and `docker load`s the tarball for that SHA (using a read-only deploy token, skipping
   the download if the tag is already loaded locally), runs Alembic migrations as a one-shot (a
   failure aborts the deploy and leaves the previous containers running), brings the stack up, and
   records the tag only once that has all worked.

**Deploys are automatic** on every green `main` pipeline — merging is releasing, which fits the
rapid usability-testing loop with the client. The guardrails: deployment records to the GitLab
`production` environment (deploy history and one-click redeploys, restricted to Maintainers), a
`resource_group` so two deploys never run concurrently, and the deploy job is never auto-cancelled.

**Rollback is a redeploy of an older SHA** — image tags are immutable per commit, so rolling back
means re-running an older pipeline's deploy job (or `ssh deploy@<vps> <older-sha>`), not rebuilding.
Reach is bounded by the package registry's 10-package retention, plus the handful of recent image
tags `deploy.sh` keeps loaded on the VPS. Rolling back past a migration needs the schema downgraded
from the newer image first; `deploy.sh` detects that case and refuses rather than failing halfway.

### Slack alerts

Two messages, both `main`-only, sent to an incoming webhook:

| Alert               | Sent when                                                         |
| ------------------- | ----------------------------------------------------------------- |
| ✅ Deployed `<sha>` | the deploy job finishes cleanly — quotes the SHA and the site URL |
| ❌ Pipeline failed  | any job in a `main` pipeline fails, at any stage                  |

The failure alert deliberately doesn't wait on the deploy job: a `main` pipeline that breaks in
lint, test or build never reaches deployment, and that is exactly when a broken `main` is worth
announcing.

Nothing is sent for merge-request or branch pipelines, and there is no "deploy started" message —
the signal is the outcome, not the attempt. A failed registry prune is also silent, since it is
allowed to fail without reddening an otherwise successful deploy. Both jobs are conditional on a
`SLACK_WEBHOOK_URL` variable: while it is unset or blank they drop out of the pipeline entirely,
rather than failing it.

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
state.
