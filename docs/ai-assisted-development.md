# AI-Assisted Development

MatchPoint is developed with AI coding assistants (primarily
[Claude Code](https://claude.com/claude-code)) as a routine part of the workflow. This document
records the conventions and mechanisms that make that work reliably, and why. All of it is checked
into the repository, so every developer inherits the same assistant behaviour rather than
configuring their own in isolation.

## Guiding principles

**Plan before code.** Non-trivial work starts by exploring the relevant code and agreeing an
approach — assumptions named, ambiguities raised as questions rather than resolved silently — before
any editing begins. Correcting a plan costs a sentence; correcting a finished implementation costs
the implementation.

**Define success as something checkable.** Requests are framed as verifiable goals: "add validation"
becomes "write tests for the invalid inputs, then make them pass". The assistant then has a target
it can iterate against and can tell when it is done, rather than stopping at code that looks
plausible.

**Keep every diff reviewable.** An assistant produces code faster than anyone can carefully read it,
so reviewability is the binding constraint, not throughput. Per `CONTRIBUTING.md`: changes are
surgical, touching only what the request requires; commits are atomic, one logical change each, with
branch history kept clean enough to review commit by commit; merge requests stay small and scoped.

**Every line is reviewed by a human.** Direct pushes to `main` are blocked, so all AI-generated code
arrives through a merge request and is read line by line — at minimum by its author, ideally by a
second team member. Reviewing it makes it yours: approved code is the reviewer's responsibility, and
"the AI wrote it" is not an explanation for a defect.

## Context is a budget

An assistant's accuracy is bounded by what is in its context window, and that window is finite.
Every convention loaded costs space that could hold the code being worked on. Two consequences shape
everything below:

- **Scope drives cost.** A convention that only matters for `apps/api/` should not be loaded when
  editing the web app. Rules are written in the narrowest scope that covers them.
- **Prose is the last resort.** Where a convention can be enforced by a linter, a type checker, or a
  CI job, it is. The written rule then explains the _why_ that an error message cannot.

### Layered instruction files

Instructions are split across four tiers by scope and audience:

| Layer                                                     | Scope                               | Committed       | Holds                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                               | Whole repo, always loaded           | Yes             | Project-wide only: pnpm-not-npm, git workflow, the formatting gate, code-style thresholds, repo layout, stack, and the brief |
| `.claude/rules/*.md`                                      | Path-scoped via `paths` frontmatter | Yes             | Area-specific invariants, loaded only when matching paths are touched                                                        |
| `.claude/skills/*/SKILL.md`                               | Task-scoped, loaded on demand       | Yes             | The ordered procedure a whole task follows, matched from its description rather than from a path                             |
| `.claude/rules/*.local.md`, `.claude/settings.local.json` | Personal                            | No (gitignored) | Individual preferences and habits                                                                                            |

Rules and skills divide on invariants versus procedure. A rule states what must always hold in an
area and is loaded whenever that area is touched; a skill walks the steps a particular job takes and
is loaded only when that job comes up. A skill that restates its area's rules pays for them twice
and leaves two copies to drift, so it cites them instead.

`CLAUDE.md` opens with a rule governing its own growth: only add something there if it is genuinely
meant for the whole team, and put area-specific conventions in `.claude/rules/` instead. The
always-loaded layer stays small because the file polices itself.

**The assignment brief is embedded in `CLAUDE.md`**, together with an instruction to push back on
work that does not clearly serve it — scope creep, speculative features, drift. The assistant is
given the project's success criteria, not only its coding conventions, so it can challenge a request
rather than dutifully implement it.

### Path-scoped rules

Each committed rule declares a `paths` glob in its frontmatter:

| Rule                | Paths                              | Protects                                                                                              |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `api.md`            | `apps/api/**`                      | Sync SQLAlchemy, `def` (not `async def`) database routes, Alembic from the first table, uv-not-pnpm   |
| `api-models.md`     | Model modules                      | Deletion over flagging and who owns the cascade, client-assignable UUID ids, enums as VARCHAR + CHECK |
| `api-routes.md`     | Routers and schemas                | `XCreate` as the client-settable columns, whole lists scoped by ownership, letting Pydantic raise 422 |
| `api-migrations.md` | `apps/api/migrations/**`           | Alembic's `generic` template plus the two local `env.py` edits; no `sqlalchemy.url` in `alembic.ini`  |
| `api-data-model.md` | Model modules and migrations       | The ERD in `docs/data-model.md` updated in the same commit as any change to the schema's shape        |
| `api-tests.md`      | `apps/api/tests/**`                | A test tree mirroring the source; real Postgres over SQLite or a mocked session; savepoint rollback   |
| `api-spec.md`       | Routers, schemas, app factory      | Regenerating the spec and TypeScript client in the same commit as the change that moved them          |
| `api-client.md`     | `packages/api-client/**`           | Generated output, never hand-edited: fix the API, then regenerate                                     |
| `web.md`            | `apps/web/**`                      | Tailwind v4 CSS-first via `@theme`, feature slices, the `@/` alias, kebab-case filenames              |
| `web-capture.md`    | `apps/web/src/features/capture/**` | A network-free capture path; portrait _and_ landscape; touch-first affordances                        |
| `web-components.md` | `apps/web/src/components/**`       | Components generated via the shadcn CLI; Base UI, not Radix                                           |
| `web-tests.md`      | Vitest and Playwright test files   | The two runners kept off each other's files; co-located tests; queries by accessible role             |
| `docs.md`           | `docs/**`                          | Finished documentation only; drafts to gitignored `docs/scratch/`                                     |

Two deliberate patterns run through them.

**A rule is written when the convention is decided, not when it is first broken.** Recording an
invariant at the point the team agrees on it costs a few lines; discovering it was never written
down after a wrong-shaped implementation costs a rewrite. The rule set therefore tracks the
project's architectural decisions rather than its bug history.

**Rules name the failure mode, not just the correct answer.** `api.md` does not only say "use sync"
— it explains that an `async def` route holding a blocking query stalls every other in-flight
request, and that the bug is quiet: it passes tests and works fine for one user, surfacing only as
latency under concurrency. `web.md` names the specific way an assistant gets Tailwind wrong (a v3
answer to a v4 question) and prescribes the fix. Stating the trap is what prevents a
plausible-but-wrong answer from being generated in the first place.

## Mechanical enforcement

A convention only the assistant reads is a suggestion; a failing pipeline is a guarantee. Where the
invariant can be machine-checked, it is:

**ESLint encodes the capture-path invariant.** The `features/capture` block in `eslint.config.mjs`
restricts imports of `**/sync/**`, `@matchpoint/api-client`, and `**/features/analytics/**` under
`apps/web/src/features/capture/**`, and its error message states the reason and the correct
alternative — append to the outbox; `sync/` drains it. The architectural invariant is expressed as a
lint failure rather than as a note somebody has to remember.

**CI runs the same checks as the local scripts.** `scripts/check.sh` runs the full lint, type, and
test suite locally in report-only mode, and `scripts/format.sh` in write mode; the pipeline
(`.gitlab-ci.yml`) runs the identical checks in verify mode. `CLAUDE.md` requires `format.sh` before
every commit, so assistant-generated code lands in the same shape as hand-written code and diffs
stay reviewable.

**Tool versions are enforced, not documented.** `packageManager` and `engines` in `package.json`,
`.nvmrc`, `apps/api/.python-version`, and `required-version` in `apps/api/pyproject.toml`. An
assistant reaching for `npm` or the wrong Python is stopped by the toolchain rather than by a line
of prose.

Not every invariant can be machine-checked, and the rules are explicit about which are. Where an
invariant rests on review rather than on tooling — as the no-hand-edits rule for the generated API
client does — the rule states that, so a passing pipeline is never mistaken for proof that the
convention held.

## Sorting work before it's delegated

Every issue is labelled at filing with one of three triage labels, which say how it should be worked
rather than what it's about:

- `ai-hands-off`: an agent can take it end to end, no input needed.
- `ai-high-touch`: the programmer works through it closely with the AI, rather than handing it off.
- `awaiting-decision`: it's parked on an open question, along with anything it blocks.

## Tooling: MCP servers and skills

**`.mcp.json`** configures a single MCP server, `shadcn`, invoked through the workspace
(`pnpm --filter @matchpoint/web exec shadcn mcp`) so it resolves the project's pinned CLI rather
than an ambient global install. It is committed so the team shares the definition, while opting in
stays personal via `enabledMcpjsonServers` in the gitignored `.claude/settings.local.json`. The
restraint is the point: MCP servers cost context on every request, so only one is configured, and
only because component generation genuinely needs registry lookup.

**`.claude/skills/`** holds both vendored and first-party skills. Vendored ones are committed rather
than fetched at runtime, so behaviour is reproducible and any change shows up in a diff;
`skills-lock.json` records each one's upstream source and a content hash, so the copy can be traced
back and re-verified. A skill written here has no upstream and so no lock entry — it is ours to edit
and, unlike the vendored copies, is formatted with the rest of the repo.

The division of labour between the two is spelled out in `web-components.md`: the skill carries the
composition, styling, and forms conventions, while the MCP server only provides registry
search/view/install-command lookup. Knowing which supplies what avoids querying the wrong source.

## Keeping the instructions correct

The instruction files are only as useful as they are accurate, so they are maintained like code.

- `CLAUDE.md` and `README.md` cross-reference rather than duplicate (`@CONTRIBUTING.md`,
  `@README.md`), so the stack table and repository layout have a single authoritative home.
- `CLAUDE.md` requires the stack table to be updated when the stack changes, and `.gitignore` to be
  updated in the same change as the tool that generates the artefacts. Drift is closed at commit
  time rather than during a later audit.
- `README.md` is the single source for the repository layout, so a new folder follows the documented
  structure instead of one inferred from whatever happens to exist.
- `docs.md` holds `docs/` to a finished-quality bar and routes drafts to gitignored `docs/scratch/`,
  so what an assistant reads back as project documentation is never half-written notes.
