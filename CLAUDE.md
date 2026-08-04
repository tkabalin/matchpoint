# CLAUDE.md

## Claude Conventions

- This file is checked into the repo and shared with every dev — only add something here if it's
  genuinely meant for the whole team. If it's specific to how you personally work (preferences,
  one-off context, etc.), save it to project memory instead.
- Rules that only apply to a specific area of the codebase (e.g. `api/`, `web/`) should be added as
  path-scoped rules under `.claude/rules/` (using the `paths` frontmatter field), not put here —
  keep this file for project-wide guidance only.

## Tooling & Git Workflow

- This project uses `pnpm`, not `npm` or `yarn`. Use `pnpm install`, `pnpm add`, `pnpm exec`,
  `pnpm dlx`, etc.
- For commit, branch, and other git workflow conventions, see @CONTRIBUTING.md.
- Never push (`git push`) without explicit permission in that same turn.
- Always run `scripts/format.sh` before committing.
- `scripts/check.sh` (format check/lint/typecheck/test) is optional locally and not required before
  every commit — CI runs the same checks on push — but running it before pushing catches failures
  earlier.
- Keep `.gitignore` in step with the tooling: when you add or remove a tool, framework, or language,
  add or remove its generated artefacts in the same change.

## Code Style

- Don't abstract or extract shared code until there are at least two call sites needing it — either
  two real usages, or one usage plus a second that's definitely coming. A merely hypothetical future
  usage doesn't justify the abstraction.

## Repository Layout

- New folders should follow the repository structure documented in @README.md, except where that
  structure obviously doesn't account for the kind of file being added.

## Tech Stack

- See the Stack table in @README.md for the current tech stack. Each time a new item is added to the
  stack, it should be documented here.
- `pnpm-lock.yaml` and `apps/api/uv.lock` remain the authority for exact dependency versions.

## Assignment Brief

> Below is the brief for the assignment. All decisions should be made with this as the final goal.
> Push back — don't just comply — when a request doesn't clearly serve it: scope creep, speculative
> features, or work that drifts from what the brief actually asks for.

Aspiring tennis players can benefit from analysis of their performance, but unfortunately a lot of
the detailed match data available to professional players is collected using expensive specialist
systems, or post-match video analysis. For amateur coaches and players, identifying patterns in
performance, comparing players across matches, or making evidence-based decisions during training
remains challenging.

MatchPoint is a tennis statistics tracking application that enables coaches to track live match
performance, then analyze player tendencies, and so make more data-driven coaching decisions.

The system allows coaches to create and manage players and matches and record match metadata. The
design of an effective interface for this is key to the project. During a match, MatchPoint allows
the user to capture points data live with no more than three taps: e.g. serves, double faults, rally
outcomes and rally length. The application also supports efficient, rapid setup of player profiles
and matches. It also supports an analytics dashboard showing statistics such as serve percentage,
rally-length win percentage, trends across matches, opponent performance, coach notes and training
focus areas.

During the project, the team engages with BBD as an industry client to refine the requirements,
prioritise statistics, and test the usability of the live data-entry workflow.
