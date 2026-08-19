/**
 * Match-level flow — the layer above `capture-flow.ts` (which builds one Point at a
 * time, given `sequence`/`server` as inputs it never derives) and below any future
 * UI. Pure functions over `Point[]`/`Match`, no state of its own: matches `state.ts`'s
 * convention, not `capture-flow.ts`'s. There's no multi-step wizard here the way a
 * single point's capture has one — every question this module answers ("what
 * sequence is next," "who serves next," "is the match over") is a pure derivation
 * from already-existing facts, so introducing a second, module-owned state container
 * would just be a second copy of "what happened in this match" to keep in sync with
 * the outbox, which is exactly the snapshot format `outbox.ts`'s own doc comment says
 * shouldn't need to exist.
 *
 * Stays outbox-agnostic and fully synchronous on purpose, even though `features/
 * outbox/` is importable from here (the one documented cross-slice exception, see
 * `.claude/rules/web.md`) — a caller (a future store/hook) is free to call
 * `outbox.readByMatch`/`outbox.remove` itself alongside these pure functions, the
 * same two-step shape a tap handler already uses for `commitDraft` + `outbox.append`.
 */

import { startPoint } from "./capture-flow";
import type { CaptureState } from "./capture-flow";
import { Match } from "./match";
import type { Point, Server } from "./point";
import { finalWinnerFor, matchSetsFor, nextServerFor, otherIdOf } from "./state";
import type { MatchSetsState } from "./state";

/**
 * The next point's sequence number. Not `points.length` — once a point can be voided
 * (see `voidPoint`), the two diverge: removing one point out of 8 (sequences 0-7)
 * leaves 7 points whose sequences still reach 7, and `points.length` (7) would hand
 * out 7 again, colliding with the point still holding it. Deriving from the max
 * avoids that by construction; `matchSetsFor` and everything below it only ever
 * require non-decreasing sequence order, never contiguity, so a gap here is fully
 * supported already.
 */
export function nextSequenceFor(points: readonly Point[]): number {
  if (points.length === 0) return 0;
  return Math.max(...points.map((point) => point.sequence)) + 1;
}

/**
 * `nextServerFor` (state.ts) returns an id — the vocabulary `Match` and `MatchSet`
 * use — but `capture-flow.startPoint` needs the "TRACKED"|"OPPONENT" role a `Point`
 * itself carries. This is that translation. It belongs here, not on `startPoint`
 * itself: a Point/draft deliberately carries no `trackedPlayerId`/`opponentId` (see
 * point.ts's own doc comment), so extending `startPoint` to accept an id would
 * require it to know `Match.trackedPlayerId`, breaking that boundary. `match-flow.ts`
 * is the layer that already knows both sides, so translating is its job.
 */
export function nextServerRoleFor(liveSets: MatchSetsState, match: Match): Server {
  const id = nextServerFor(
    liveSets,
    match.scoringSystem,
    match.firstServer,
    match.trackedPlayerId,
    match.opponentId,
  );
  return id === match.trackedPlayerId ? "TRACKED" : "OPPONENT";
}

/**
 * Everything needed to start capturing the next point, derived from what's already
 * committed — the composing entry point `capture-flow.ts`'s own doc comment names as
 * this module's job. Re-derives nothing: calls `matchSetsFor`, `nextServerRoleFor`,
 * `nextSequenceFor`, and `capture-flow.startPoint`, in that order.
 */
export function startNextPoint(match: Match, points: readonly Point[]): CaptureState {
  const liveSets = matchSetsFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );
  const server = nextServerRoleFor(liveSets, match);
  const sequence = nextSequenceFor(points);
  return startPoint(match.matchId, sequence, server);
}

/**
 * Removes a committed Point by id — the match-level undo (§6's second half, distinct
 * from capture-flow's own mid-capture undo of an in-progress draft). Pure `Point[] ->
 * Point[]`, mirroring `commitDraft`'s own I/O-free convention: it doesn't call
 * `outbox.remove` itself, leaving that to the caller (same two-step shape as
 * `commitDraft` + `outbox.append`). Never renumbers the remaining points — sequence
 * gaps persist permanently. That's not a shortcut: `Point` is immutable and
 * identified by `id`, and `outbox.append` is first-write-wins by id and never
 * rewrites a queued payload, so "renumbering" a later point would mean deleting and
 * re-appending it under a new payload for the same id, which the outbox's own
 * contract doesn't allow.
 */
export function voidPoint(points: readonly Point[], pointId: string): Point[] {
  const filtered = points.filter((point) => point.id !== pointId);
  if (filtered.length === points.length) {
    throw new Error(`no point with id ${pointId} in the given points`);
  }
  return filtered;
}

/**
 * Records a retirement (§8) at the match level — the in-progress point itself is
 * discarded identically to a let reset (capture-flow's own TAP_LET on RALLY already
 * does that, nothing new needed there), so this covers only the fact that needs
 * recording on `Match`. `Match.outcomeOverride` already carries everything §8 asks
 * for: `reason` is `"retirement"`, and "who retired" is fully recoverable as the
 * *other* participant from `winner` (a retirement's winner is, by definition, the
 * player who didn't retire) — no new field is missing.
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
 * Whether the match is over — composing `matchSetsFor` + `finalWinnerFor`, re-deriving
 * neither. Short-circuits on `outcomeOverride` before paying for `matchSetsFor`'s
 * replay, since a retired/walkover/default match is over regardless of what its
 * points look like.
 */
export function isMatchOver(match: Match, points: readonly Point[]): boolean {
  if (match.outcomeOverride !== null) return true;
  const { completedSets } = matchSetsFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );
  return finalWinnerFor(match, completedSets) !== null;
}
