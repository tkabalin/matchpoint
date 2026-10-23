# Contributing

The remote is university-hosted GitLab, not GitHub: `git@gitlab.cs.uct.ac.za:tldr/matchpoint.git`.

That's why CI is `.gitlab-ci.yml` and why this document says _merge request_ rather than _pull
request_.

## Branching & merge requests

- Branch off `main`: `firstname/kebab-case-description` (e.g. `thomas/live-capture-ux`).
- Unless otherwise agreed with the branch owner, only that person pushes to their branch — this
  avoids conflicting history and force-push surprises.
- Keep merge requests small and scoped to one logical change, where possible.
- CI must be green before merging.
- Direct pushes to `main` are blocked.
- Merges use **rebase merge** — squash and merge commits are blocked. Keep commit history clean on
  the branch itself (see below) since it lands on `main` as-is.

## Commit messages

Conventional Commits: `type: short summary`.

Valid types: `feat:`, `fix:`, `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`,
`test:`. Always include the type.

Scope is optional — include it only where it's a clear, useful disambiguator (`fix(scoring): ...`);
leave it out otherwise.

Large or non-obvious commits should include a description body explaining the _why_, not just the
one-line summary.

## Code style

Python (`apps/api/`) uses [Ruff](https://docs.astral.sh/ruff/) for both linting and formatting, and
[Pyright](https://microsoft.github.io/pyright/) for type checking; the web app and
Markdown/YAML/JSON use [Prettier](https://prettier.io/) for formatting,
[ESLint](https://eslint.org/) for correctness, and `tsc` (`pnpm run typecheck`) for type checking.
Shared editor settings live in `.editorconfig`.

CI runs the non-mutating variants (`ruff format --check`, `pnpm run format:check`), so a formatting
slip fails the pipeline rather than being quietly corrected.

`scripts/format.sh` runs both formatters and is required before every commit; `scripts/check.sh`
runs the full format-check/lint/typecheck/test suite — the same non-mutating variants CI uses — and
is optional but recommended before pushing.

On an in-progress branch, prefer fixing a bug by amending the commit that introduced it
(`git commit --amend` / interactive rebase), then force-pushing if it's already on remote — this
keeps the branch's history easy to review. This is a loose preference, not a rule: only do it when
straightforward, and don't reach for complex git surgery to satisfy it.

## Development workflow

The README's Development section gets the app running. This section is the rest of the day-to-day
workflow.

### Checks

`scripts/check.sh` runs its checks concurrently and lets every one finish, so a single run reports
all the failures rather than stopping at the first. Like CI, it only reports and never rewrites
files, so run `scripts/format.sh` to fix what it flags. Each step is a plain package-manager command
you can also run on its own:

```sh
# From the repo root
pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test

# From apps/api
uv run ruff format . && uv run ruff check . && uv run pyright && uv run pytest
```

Coverage is opt-in on both sides, so it is not part of `scripts/check.sh` or the plain test
commands. For a report, run `uv run pytest --cov` from `apps/api`, or
`pnpm --filter @matchpoint/web run test --coverage` from the repo root; CI collects both.

The Playwright suite in `apps/web/e2e/` is left out of `scripts/check.sh` because it is the slow
tier; CI runs it on every push. Playwright starts the Vite dev server and the API itself, the latter
through `scripts/e2e-api.sh` on a database of its own, so the Compose Postgres must be up and any
dev API must be stopped first.

### Regenerating the API client

The web app calls the API through `packages/api-client`, generated from the API's own OpenAPI spec.
A route's request and response types are therefore the ones the frontend compiles against, and a
mismatch is a type error rather than a runtime surprise.

Both the spec (`apps/api/openapi.json`) and the generated client are committed. After changing
anything a route exposes, regenerate them and commit the result alongside the change:

```sh
scripts/gen-api-client.sh
```

A stale spec fails `uv run pytest` in `apps/api`, and a stale generated client fails CI's
`web-api-client` job, which regenerates the client and diffs it against what was committed. Neither
is covered by `scripts/check.sh`, so run the script whenever a route changes.

### Dependencies

`apps/api` is a uv project, deliberately **not** a pnpm workspace member, so never run
`pnpm install` inside it.

pnpm 11 enforces a `minimumReleaseAge` supply-chain policy: packages published within the last day
are rejected. If `pnpm install` fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` after you add a
dependency, the fix is normally to wait rather than to relax the policy.
