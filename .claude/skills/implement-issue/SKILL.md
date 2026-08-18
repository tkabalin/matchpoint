---
name: implement-issue
description:
  Work a single GitLab issue end to end. Fetches the issue, implements it with an agent on its own
  branch in its own worktree, reviews the finished branch with /code-review high, folds the fixes
  into the originating commits, pushes, and opens an MR. Token heavy (two agents, Opus unless the
  args name another model), so only use when invoked by name ("/implement-issue 61",
  "/implement-issue sonnet 61") or when the user unambiguously asks for this agent-driven workflow.
  Never infer it from a task merely involving an issue; implement that directly instead.
---

# Working a single issue end to end

If this skill was not invoked by name and the user has not clearly asked for the agent-driven
workflow, stop here and handle the task directly; being asked to fix an issue is not enough on its
own.

You are the coordinator. You fetch the issue, launch one implementation agent, launch a review agent
when the implementer finishes, and open the MR once the branch is pushed. The agents run on the
model named in the arguments, Opus by default. Invoking this skill is the explicit permission to
push the one branch it creates: the review agent pushes it exactly once, plain push, never main,
never force.

Agents never stop to ask the user anything. Every question an agent would have asked gets weighed
against the assignment brief and repo conventions, decided, and recorded; every such decision
surfaces in the MR's "Decisions for review" section. This rule goes verbatim into every agent
prompt, and it is the most important rule in this skill.

## 1. Fetch and plan

1. Parse the arguments: the issue number (`61` or `#61`), plus an optional model name for the agents
   (`opus`, `sonnet`, `haiku`, or `fable`, given bare or as `--model <name>`). Default to `opus`
   when none is given; both the implementer and the reviewer use the same model.
2. Fetch the issue with `glab issue view <n> --comments` (glab is authenticated for
   gitlab.cs.uct.ac.za; it is a snap and cannot read `/tmp`, so never hand it a `/tmp` path). Read
   the full description, every comment, and any linked issues — comments often carry scope changes,
   clarifications, or client (BBD) feedback that the description alone won't show.
3. If the issue is blocked by an open issue, stop and report that rather than guessing at the
   missing dependency.
4. Check the open MRs for overlap with this change (another open branch adding an Alembic revision
   off the same parent, or touching the same files); overlap never blocks the work, it becomes a
   merge note in the MR.
5. `git fetch origin` once. The branch bases on `origin/main`, not the local `main`.
6. Create the worktree from the main checkout:
   `git worktree add .claude/worktrees/<slug> -b thomas/<slug> origin/main` with `<slug>` a short
   kebab-case description of the change (CONTRIBUTING's branch convention). Worktrees always go
   under `.claude/worktrees/` (already gitignored), never as sibling directories outside the repo.

## 2. The conventions block

Paste this block into both agent prompts, implementer and reviewer alike, with the placeholders
filled in:

- Work only inside `<worktree path>`. The Bash cwd persists between calls and drifts, so use
  absolute paths in every command, especially writes.
- Read `CLAUDE.md`, the relevant `.claude/rules/` files, and the docs they point to before writing
  code. Follow them. `pnpm` not `npm`; `uv run` for everything in `apps/api`.
- Run `scripts/format.sh` before every commit. Conventional commits, atomic commits, the body
  explains the why. Add `Closes #<n>` to the body of the commit that fully resolves the issue.
- Never run `scripts/check.sh` from a worktree (its Compose probe fails there). Run the eight checks
  it wraps individually:
  - repo root: `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`
  - `apps/api`: `uv run ruff format --check .`, `uv run ruff check .`, `uv run pyright`, and pytest
    as below.
- pytest drops and recreates the single `matchpoint_test` database per session, so concurrent suites
  clobber each other. Always serialize it across sessions:
  `flock -w 900 /tmp/matchpoint-pytest.lock uv run pytest`.
- If the change touches the API surface, regenerate the spec and TS client with
  `scripts/gen-api-client.sh` in the same commit as the change.
- If the change adds a migration, never autogenerate against the local dev database (its schema is
  stale); write the revision by hand, and confirm `alembic heads` reports exactly one head.
- Prose bans, everywhere (code comments, docstrings, commits, docs): no em dashes, never the phrase
  "load-bearing".
- Never ask the user anything. When a question comes up, weigh the options against the assignment
  brief and the repo's conventions, pick the best one, and record it: what you chose, why, and —
  only when a real alternative was seriously weighed — what it was and why you ruled it out (don't
  invent an alternative just to fill this in). Also record your confidence in the call (High,
  Medium, or Low) so the reviewer knows where to spend attention, and — only when it applies —
  whether the choice deviates from the standard, idiomatic, or canonical way of doing this in the
  language, framework, or codebase, and why: a deviation can be made with full confidence, but the
  reviewer still needs to know it's there. These come back to the coordinator and become the MR's
  "Decisions for review" bullets, which is how the user reviews your judgement, so record every real
  choice.
- Write every decision, and anything else destined for the MR description, for a reader with no
  prior experience of the frameworks, libraries, or techniques involved. Name an unfamiliar tool
  once and gloss what it does in a clause; don't assume the reader already knows it.
- Don't append to `docs/scratch/decisions.md` yourself, even though a repo rule says to log
  decisions there: that file lives in the main checkout, and the coordinator writes the entries once
  at wrap-up, so an agent's append is a duplicate. Returning the decision is the log.

## 3. The implementation agent

Launch the implementer: `subagent_type: general-purpose`, `model: <the chosen model>`, background
(the default) so you can react when it finishes.

An agent can also die of a stalled stream rather than a real failure (the notification names it,
e.g. "no progress for 600s"). Nothing is lost: its worktree and commits are as it left them. Resume
the same agent with a message saying where it stopped and repeating the return contract, instead of
relaunching from scratch.

The prompt contains: the full issue text pasted in (title, number, description), the worktree path
and branch name, the conventions block, and this return contract:

- Implement the issue completely, tests included, on the branch. Surgical changes only: touch
  nothing the issue does not require.
- Do not push. Commit only.
- Return: branch name, a one-paragraph summary of the change, the decisions list (each entry: what
  was chosen, why, any alternative seriously weighed and ruled out, a confidence rating
  High/Medium/Low, and — only when it applies — how the choice deviates from the standard or
  idiomatic approach and why), whether the change touches auth, sessions, migrations/schema,
  security headers/config, rate limiting, or any field holding personal data — name which, or say
  plainly that none apply, since silence reads as an oversight rather than a "no" — the result of
  each of the eight checks (with test counts and coverage), anything noticed that will conflict with
  open MRs, and every step the change needs that only a human can do (copy files onto the VPS, set a
  CI variable, mint a token, add a DNS record). Manual steps become a checklist in the MR, so an
  unreported one is a deploy that breaks after merge.

## 4. The review agent

When the implementer finishes, spawn a fresh review agent (same model) for the worktree. Its prompt
contains the worktree path, branch name, issue number, the implementer's summary, the conventions
block, and:

- Run the `code-review` skill at `high` effort, review-only, never `--fix`. A subagent cannot move
  its session into the worktree (`EnterWorktree` refuses both a repo-root cwd and a cwd override),
  so a `--fix` pass forks with the shared main checkout as its cwd and writes fixes into the wrong
  tree. Target the review explicitly at the branch (or the worktree path), reviewing the committed
  diff against `origin/main`, then apply each accepted finding to the worktree by hand. Drop any
  finding you judge a false positive and say why in your return.
- Fold each applied fix into the commit that introduced the code, so the branch lands as if written
  correctly the first time. Never create `fixup!` or follow-up patch commits. Mechanism: save the
  fix as a patch, restore a clean tree, then
  `GIT_SEQUENCE_EDITOR='sed ...' git rebase -i --autostash origin/main` marking the target commit
  `edit` (match it by subject, not hash), apply the patch, `git commit --amend --no-edit`,
  `git rebase --continue`. A fix that is a genuinely independent logical unit becomes its own atomic
  commit instead.
- After folding, re-read each rewritten commit's message. A fix can overturn a claim the body makes
  (a behaviour the code no longer has); amend the message at the same rebase stop.
- Re-run `scripts/format.sh` and the eight checks (pytest under the same flock) after folding.
- Before pushing, sweep the branch for banned prose; the ban is stated in every prompt and has still
  slipped through into docstrings: `git diff origin/main | grep -nE '—|load-bearing'` and
  `git log origin/main.. | grep -nE '—|load-bearing'` must both come back empty.
- Push exactly once: `git push -u origin <branch>`. The branch has never been pushed, so a plain
  push must succeed; if it rejects, stop and report instead of forcing.
- Return: the pushed tip SHA, what the review found (fixed, and rejected with reasons), any new
  decisions made while fixing (same shape as the implementer's: what, why, alternatives ruled out if
  any, confidence, convention deviation if any), whether a fold-in fix changed the answer to the
  implementer's sensitive-area question (e.g. a fix that adds a migration), any manual steps the
  implementer missed, and the final check results.

## 5. The MR

When the review agent reports a green push, open the MR from the main checkout. Build the
description in a file first, then pass it inline, since glab cannot read `/tmp`:

```
glab mr create --source-branch thomas/<slug> --target-branch main --yes \
  --title "<subject of the branch's main commit>" \
  --description "$(cat <description file>)"
```

The description follows the house shape. It must read cleanly for someone with no prior experience
of the frameworks, libraries, or techniques the branch touches: gloss any tool by name on first use,
and prefer bullets and arrows over prose wherever a fact needs to be scanned rather than read top to
bottom.

```
## Summary

<A short plain-language paragraph: what the MR adds, and how it fits the surrounding
work.>

**Touches:** <sensitive area(s) named plainly, e.g. "coach sessions, a new migration"
— or "no security- or data-sensitive areas" when none apply. Always present, never
omitted: "none" is itself useful information.>

Closes #<n>

## Decisions for review

- **<Short bold title.>**
  - **Decision:** <what was chosen, in plain language>
  - **Why:** <the reasoning>
  - **Alternatives considered:** <option(s) seriously weighed and why each was ruled
    out — omit this line entirely when there was really only one reasonable choice>
  - **Confidence:** High | Medium | Low
  - **Convention:** <how this deviates from the standard/idiomatic/canonical approach,
    and why — omit this line entirely when the choice follows the standard approach>

<One such bullet per question the agents chose not to ask.>

## Review

A `/code-review high` pass ran over the branch:

- <One bullet per finding: what it was, and "fixed, folded into the originating
  commit" or "rejected — <reason>". If nothing was found, a single "No defects
  found." line replaces the bullets.>

## Verification

<Suites and counts, e.g. "full API suite (N passed, coverage 100% statement and
branch), ruff, pyright, eslint, tsc, vitest, prettier all green.">

## Merge notes

- <One bullet per fact a reviewer needs to land this safely: expected conflicts with a
  named open MR and how to resolve them (e.g. "regenerate the client with
  scripts/gen-api-client.sh on rebase, don't hand-merge"), the alembic re-parent if an
  open MR added a migration off the same parent, shared-file notes.>
- Landing order: <"!<n> must land first/after this" when an open MR constrains it, or
  "standalone, no ordering constraints" — state it explicitly either way, and why.>

## Manual steps

- [ ] <Each step only a human can do, phrased as a runnable action: what to copy where,
      which variable to set to what, in which UI or on which host. One box per step.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

The manual-steps section collects everything the agents returned that the change needs but nobody
automated: files to copy onto the VPS, CI variables, tokens, DNS records. GitLab renders `- [ ]` as
tickable checkboxes on the MR. Say whether each step must happen before or after the merge when it
matters, and omit the whole section when there is nothing manual; never write an empty "none"
section.

Non-negotiables: `Closes #<n>` appears in the description so GitLab closes the issue when the MR
merges; the decisions section merges the implementer's and reviewer's lists, complete; the prose
bans apply to the description too. Do not merge the MR or approve it: the user reviews manually.

## 6. Wrap up

- Report the issue, branch, and MR URL, plus the decision highlights and any expected conflicts with
  open MRs.
- Repeat the MR's manual steps in the report, so nothing waits to be discovered on the MR.
- Collect the follow-up candidates the review surfaced (real findings judged out of scope for the
  branch) and list them in the report so they can be filed as GitLab issues; a pending action left
  in notes or memory is a pending action lost.
- Append the substantive decisions to `docs/scratch/decisions.md` in the main checkout.
- Leave the worktree in place until the MR merges; it is removed with
  `git worktree remove .claude/worktrees/<slug>` afterwards, not now.
