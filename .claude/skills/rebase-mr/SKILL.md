---
name: rebase-mr
description:
  Rebase one branch onto its actual merge target (an open MR's target branch, or `main` when there
  is none), applying the two known conflict recipes this repo already documents by convention
  (regenerate the API client rather than hand-merge it; re-parent a colliding Alembic migration) and
  any resolution an MR's "Merge notes" section names, then force-push. Takes an MR number or a
  branch name; with neither, uses the currently checked-out branch. Invoking this skill by name is
  itself the user's explicit, standing permission to force-push the branch it operates on. Only use
  when invoked by name ("/rebase-mr", "/rebase-mr 141", "/rebase-mr thomas/foo") or when the user
  unambiguously asks for this branch to be rebased and force-pushed; never infer it from a task that
  merely touches git or an MR.
---

# Rebasing a branch onto its real target and force-pushing it

If this skill was not invoked by name and the user has not clearly asked for a rebase-and-force-push
of a specific branch, stop here and handle the task directly.

You do this yourself, inline — no subagent. It's a mechanical git operation, not an implementation
task, and the two agents used by `implement-issue`/`parallel-issues` exist to parallelize writing
code and reviewing it, neither of which applies here.

Never run the rebase in the main checkout. A stale local branch ref or a `rebase -i` racing another
session's checkout has already bitten this repo once — always do the actual git surgery in a
worktree under `.claude/worktrees/`.

## 1. Resolve the branch and its target

1. Parse the argument, if any:
   - A bare number or `#<n>` → an MR IID.
   - Anything else → a branch name.
   - Nothing → the current branch of the main checkout: `git -C <repo-root> branch --show-current`
     (read-only, safe to run there).
2. Look up the MR: `glab mr view <n-or-branch> -F json`. This works whether you were given an IID or
   a branch name. If it succeeds, read `source_branch`, `target_branch`, and `description` from the
   JSON.
3. If it fails (no open MR for that branch), you still have a branch name (either the arg itself, or
   the current-branch fallback from step 1). Proceed with `target_branch = main` and no Merge notes
   — rebasing a branch with no open MR yet is a legitimate use of this skill.

## 2. Extract Merge notes

If an MR was found, pull the text between the `## Merge notes` heading and the next `## ` heading
(or end of description) out of its `description`. Read it as prose to consult in step 5, not
something to parse into fields — it was written by a previous agent run specifically to tell whoever
rebases this branch what will conflict and how to resolve it.

## 3. Set up the worktree

1. `git -C <repo-root> worktree list` — if an entry already checks out `source_branch`, reuse that
   path. Otherwise pick `<repo-root>/.claude/worktrees/<slug>` (`<slug>` = the branch name's last
   `/`-separated segment; if that collides with an existing worktree for a _different_ branch, fall
   back to the full branch name with `/` replaced by `-`) and create it:
   `git worktree add .claude/worktrees/<slug> <source_branch>`.
2. Do every remaining git command in that worktree with `git -C <worktree-path> ...` (or `cd` there
   for the rest of this skill) — never in the main checkout.

## 4. Fetch and reset to the real remote tip

1. `git fetch origin` (everything, not just this branch — the target branch's tip is needed too).
2. `git status --porcelain` — if it prints anything, **stop and report** the dirty files rather than
   discarding them. Several worktrees in this repo are already stale from finished branches; one
   could hold uncommitted work.
3. `git reset --hard origin/<source_branch>` even if the worktree was just reused. A worktree's
   local branch ref can be behind what actually moved on the remote, and rebasing from a stale ref
   has silently produced an empty, no-op rebase here before.

## 5. Rebase onto the target

1. `git rebase origin/<target_branch>` — plain, not interactive; nothing needs editing, only
   replaying.
2. If it finishes with no conflicts, go to step 6.
3. On a conflict, `git diff --name-only --diff-filter=U` to see what collided, then:
   - `apps/api/openapi.json` or `packages/api-client/src/*` among the conflicts → resolve any other
     conflicting hunks in the same commit first, then run `scripts/gen-api-client.sh`, `git add` the
     regenerated files, and continue. Never hand-merge these three files.
   - A conflict inside `apps/api/migrations/versions/` (two revisions parented on the same
     `down_revision`) → edit this branch's revision file to set `down_revision` to the new tip, then
     `uv run --directory apps/api alembic heads` and confirm it reports exactly one head, before
     continuing.
   - A conflict the Merge notes text names explicitly (a sibling MR's file, a shared test helper,
     with a stated fix) → apply that fix literally.
   - Both sides only _add_ new, self-contained content at the same insertion point (e.g. two new
     test cases each appended after the same anchor test, neither editing a line the other side
     touches) and nothing in either addition contradicts the other → keep both in full, target
     branch's addition first, then re-check the file for leftover conflict markers before
     continuing. The test: deleting the markers and keeping every added line from both sides
     reproduces each side's diff exactly, with no real choice to make beyond ordering.
   - Anything else → **stop, leaving the rebase mid-conflict in the worktree.** Report the
     conflicted files and whatever the Merge notes said (or that they're silent on this) so the user
     can resolve it or hand it to a follow-up agent. Do not improvise a resolution the notes don't
     describe.
   - After resolving a step's conflicts: `git add` the resolved files and `git rebase --continue`.
     Repeat this loop until the rebase completes.

## 6. Force-push

1. `git fetch origin <source_branch>` once more, immediately before pushing, to close the window
   since step 4's fetch.
2. `git push --force-with-lease origin <source_branch>`.
3. If the lease is rejected, **stop and report** rather than retrying with a bare `--force` — that
   means the remote genuinely moved since the refetch (someone else pushed), which is exactly the
   case `--force-with-lease` exists to catch, not bypass.

## 7. Report

State: the old and new tip SHAs (the old one is the recovery point if this is ever needed — the
reflog covers it, but say it explicitly), which conflict recipe(s) fired during the rebase, if any,
and the push result. If an MR was found, name it and its number, and note that CI will verify the
pushed branch — this skill does not run `scripts/check.sh` itself.
