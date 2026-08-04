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
