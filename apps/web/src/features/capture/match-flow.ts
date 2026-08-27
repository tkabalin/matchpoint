/**
 * Match-level flow — the layer above `capture-flow.ts` (which builds one Point at a
 * time, given `sequence`/`server` as inputs it never derives) and below the capture UI.
 * Pure functions over a `Scoreboard` and the match's event log, no state of its own:
 * matches `state.ts`'s convention, not `capture-flow.ts`'s.
 *
 * Everything here reads the score through `score.ts`'s fold rather than replaying
 * points itself. "What sequence is next", "who serves next", "is the match over" are
 * all one step off a board the caller already folded.
 *
 * Stays outbox-agnostic and fully synchronous on purpose, even though `features/
 * outbox/` is importable from here (the one documented cross-slice exception, see
 * `.claude/rules/web.md`) — a caller is free to call the outbox itself alongside these
 * pure functions, the same two-step shape a tap handler already uses for
 * `commitDraft` + `outbox.append`.
 */

import { startPoint } from "./capture-flow";
import type { CaptureState } from "./capture-flow";
import { Match } from "./match";
import { finalWinnerFor, otherIdOf } from "./state";
import { matchSetsOf, nextCourtSideFor, nextServerFor } from "./score";
import type { MatchEvent, Scoreboard } from "./score";

/**
 * Everything needed to start capturing the next point, derived from the board the
 * log already folded to. `sequence` is handed in rather than derived: it comes from a
 * per-match counter that never decreases, so an undone sequence is never handed out
 * again after a reload (see the match log in `features/outbox/`).
 */
export function startNextPoint(match: Match, board: Scoreboard, sequence: number): CaptureState {
  return startPoint(match.matchId, sequence, nextServerFor(board), nextCourtSideFor(board));
}

/**
 * Drops the newest event from the log — the match-level undo, and the only edit the
 * log allows behind an append.
 *
 * Tail-only by design: correcting an earlier set is a checkpoint appended *now*
 * carrying the corrected scoreboard, never a rewrite of what is already recorded. That
 * is what lets points stay immutable server-side, with no re-stamping and no revision
 * column (see §3.5 of the capture-flexibility design).
 */
export function undoLast(events: readonly MatchEvent[]): {
  events: MatchEvent[];
  removed: MatchEvent | null;
} {
  if (events.length === 0) return { events: [...events], removed: null };
  const removed = events[events.length - 1] ?? null;
  return { events: events.slice(0, -1), removed };
}

/**
 * Records a retirement at the match level — the in-progress point itself is
 * discarded identically to a let reset (capture-flow's own TAP_LET on RALLY already
 * does that, nothing new needed there), so this covers only the fact that needs
 * recording on `Match`. `Match.outcomeOverride` already carries everything: `reason`
 * is `"retirement"`, and "who retired" is fully recoverable as the *other*
 * participant from `winner` — no new field is missing.
 *
 * Doesn't check whether the match is already decided (an existing `outcomeOverride`,
 * or `isMatchOver` already true) — same scope `Match.create` itself keeps ("structural
 * checks... not tennis-logic coherence"). A caller can check `isMatchOver` first.
 */
export function retireMatch(match: Match, retiredPlayerId: string): Match {
  if (retiredPlayerId !== match.trackedPlayerId && retiredPlayerId !== match.opponentId) {
    throw new Error(
      `retiredPlayerId must be trackedPlayerId or opponentId, got: ${retiredPlayerId}`,
    );
  }
  const winner = otherIdOf(retiredPlayerId, match.trackedPlayerId, match.opponentId);
  return Match.create({ ...match.toJSON(), outcomeOverride: { reason: "retirement", winner } });
}

/**
 * Whether the match is over — an override (retirement, walkover, default) beats the
 * board, which is what `finalWinnerFor` exists to make unforgettable. Short-circuits
 * before touching the board, since a retired match is over regardless of the score.
 */
export function isMatchOver(match: Match, board: Scoreboard): boolean {
  if (match.outcomeOverride !== null) return true;
  return finalWinnerFor(match, matchSetsOf(board)) !== null;
}
