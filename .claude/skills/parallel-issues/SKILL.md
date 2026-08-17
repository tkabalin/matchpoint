---
name: parallel-issues
description:
  Work a batch of GitLab issues end to end in parallel. Fetches each issue, implements it with an
  agent on its own branch in its own worktree, reviews each finished branch with /code-review high,
  folds the fixes into the originating commits, pushes, and opens an MR per branch. Token heavy (two
  agents per issue, Opus unless the args name another model), so only use when invoked by name
  ("/parallel-issues 61 62 63", "/parallel-issues sonnet 61") or when the user unambiguously asks
  for this parallel batch workflow. Never infer it from a task merely involving one or more issues;
  implement those directly instead.
---

# Working a batch of issues in parallel

If this skill was not invoked by name and the user has not clearly asked for the parallel
multi-agent workflow, stop here and handle the task directly; being asked to fix an issue, or even
several, is not enough on its own.

You are the coordinator. You fetch the issues, launch one implementation agent per issue, launch a
review agent for each branch as its implementer finishes, and open one MR per pushed branch. The
agents run on the model named in the arguments, Opus by default. Invoking this skill is the explicit
permission to push the branches it creates: each review agent pushes its own branch exactly once,
plain push, never main, never force.

Agents never stop to ask the user anything. Every question an agent would have asked gets weighed
against the assignment brief and repo conventions, decided, and recorded; every such decision
surfaces in the MR's "Decisions for review" section. This rule goes verbatim into every agent
prompt, and it is the most important rule in this skill.

## 1. Fetch and plan

1. Parse the arguments: issue numbers (`61`, `#61`, comma- or space-separated all fine), plus an
   optional model name for the agents (`opus`, `sonnet`, `haiku`, or `fable`, given bare or as
   `--model <name>`). Default to `opus` when none is given; both implementers and reviewers use the
   same model.
2. Fetch each with `glab issue view <n> --comments` (glab is authenticated for gitlab.cs.uct.ac.za;
   it is a snap and cannot read `/tmp`, so never hand it a `/tmp` path). Read the full description,
   every comment, and any linked issues — comments often carry scope changes, clarifications, or
   client (BBD) feedback that the description alone won't show.
3. If an issue is blocked by an open issue outside the batch, skip it and say so in the final report
   rather than guessing at the missing dependency.
4. Look for overlap between the issues before launching anything:
   - **Same file, same snippet.** When two branches must add the same block to one file (a shared
     helper, a schema type), dictate byte-identical text in both prompts so the eventual merge is
     clean, and note it in both MRs' merge notes. Verify any comment rationale inside the snippet
     before dictating it: a wrong reason copied into two branches reads authoritative and survives
     until review.
   - **Two migrations.** Branches adding Alembic revisions off the same parent merge with no git
     conflict but leave two heads and a broken `upgrade head` on deploy. Both MRs' merge notes must
     say so: whichever lands second re-parents its `down_revision` and re-checks `alembic heads`.
   - Overlap never serializes the work; it becomes dictated snippets and merge notes.
5. `git fetch origin` once. Every branch bases on `origin/main`, not the local `main`.
6. Create one worktree per issue from the main checkout, serially:
   `git worktree add ~/matchpoint-wt/<slug> -b thomas/<slug> origin/main` with `<slug>` a short
   kebab-case description of the change (CONTRIBUTING's branch convention).

## 2. The conventions block

Paste this block into every agent prompt, implementer and reviewer alike, with the placeholders
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
  clobber each other. Always serialize it across agents:
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

## 3. Implementation agents

Launch all implementers in one message so they run concurrently: `subagent_type: general-purpose`,
`model: <the chosen model>`, background (the default) so you can react as each finishes.

Each prompt contains: the full issue text pasted in (title, number, description), the worktree path
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
  sibling branches, and every step the change needs that only a human can do (copy files onto the
  VPS, set a CI variable, mint a token, add a DNS record). Manual steps become a checklist in the
  MR, so an unreported one is a deploy that breaks after merge.

## 4. Review agents

As each implementer finishes, immediately spawn a fresh review agent (same model) for that worktree;
do not wait for the whole batch. Its prompt contains the worktree path, branch name, issue number,
the implementer's summary, the conventions block, and:

- Invoke the `code-review` skill with args `high --fix` from inside the worktree, reviewing the
  branch's committed diff against `origin/main`. Let it apply its findings to the working tree; drop
  any finding you judge a false positive and say why in your return.
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

## 5. One MR per branch

As each review agent reports a green push, open that branch's MR from the main checkout. Build the
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
work, referencing sibling MRs by !number where relevant.>

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
  named sibling MR and how to resolve them (e.g. "regenerate the client with
  scripts/gen-api-client.sh on rebase, don't hand-merge"), the alembic re-parent if two
  branches added migrations, shared-file notes.>
- Landing order: <an arrow chain when order matters, e.g. "!12 → !13 → !14", or "order
  among the batch does not matter" — state it explicitly either way, and why.>

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

MRs open one by one, so the first ones cannot yet cite sibling `!` numbers or the batch's landing
order. Once the last MR of the batch exists, revisit the earlier descriptions and fill both in
(`glab mr update <n> --description "$(cat <file>)"` replaces the whole description, so edit the
saved file rather than rebuilding it).

## 6. Wrap up

- Report a table of issue, branch, MR URL, plus the decision highlights and a map of expected
  cross-MR conflicts (including which order of landing is cleanest, if one is).
- Repeat all manual steps from the batch's MRs in one combined list, so nothing waits to be
  discovered one MR at a time.
- Collect the follow-up candidates the reviews surfaced (real findings judged out of scope for their
  branch) and list them in the report so they can be filed as GitLab issues; a pending action left
  in notes or memory is a pending action lost.
- Append the substantive decisions to `docs/scratch/decisions.md` in the main checkout.
- Leave the worktrees in place until their MRs merge; they are removed with
  `git worktree remove ~/matchpoint-wt/<slug>` afterwards, not now.
