/**
 * In-match capture state.
 *
 * This module — and everything else under `features/capture/` — is a network-free
 * zone: the capture path must never await I/O. ESLint enforces that at the root
 * config; see the `features/capture` block in `eslint.config.mjs`.
 *
 * This is the "flow" layer the domain model (match.ts, match-set.ts, point.ts)
 * deliberately stays out of: those classes store already-decided facts and
 * validate their own shape, but never decide what happens next. Deciding —
 * e.g. "does this point end the game" — belongs here instead.
 */

import type { ScoringSystem } from "./match";
import type { Point } from "./point";

// --- ScoringSystem-derived rules ---------------------------------------------
//
// ScoringSystem itself (match.ts) is stored data — decided once at Match,
// threaded down unchanged. What a given value actually *means* for how a
// game or set plays out is a flow decision, not a storage fact, so it lives
// here instead: each of these is the single place its mapping is made, same
// convention as Point/Match's own xFor(y) helpers.

/**
 * Whether a ScoringSystem plays with ad (win a game at deuce by 2 clear
 * points) or no-ad (sudden death at 40-40) scoring — the one axis
 * gameStateFor needs.
 *
 * TODO: confirm against the brief/BBD — "short_sets" is inferred, not
 * settled (the reference table calls it "often paired with no-ad," not a
 * hard rule), same caveat as maxSetsFor's "traditional"/"legacy" guesses.
 */
export function isAdScoringFor(scoringSystem: ScoringSystem): boolean {
  switch (scoringSystem) {
    case "no_ad_scoring":
    case "short_sets":
      return false;
    case "traditional":
    case "mens_grand_slam":
    case "womens_grand_slam":
    case "match_tiebreak_10_points":
    case "pro_set":
    case "legacy":
      return true;
    default: {
      // Exhaustiveness check: a new ScoringSystem member with no case above
      // fails to compile here instead of silently falling through.
      const unhandled: never = scoringSystem;
      throw new Error(`unhandled scoringSystem: ${String(unhandled)}`);
    }
  }
}

/**
 * The most sets a match of this format can run to — a match can finish
 * earlier (e.g. a straight-sets win), so this is a ceiling, not a
 * prediction.
 *
 * TODO: confirm against the brief/BBD once set/game rules are firmed up —
 * "traditional" and "legacy" are placeholder assumptions (best-of-3) for now.
 */
export function maxSetsFor(scoringSystem: ScoringSystem): number {
  switch (scoringSystem) {
    case "mens_grand_slam":
      return 5;
    case "pro_set":
      return 1;
    case "traditional":
    case "womens_grand_slam":
    case "no_ad_scoring":
    case "match_tiebreak_10_points":
    case "short_sets":
    case "legacy":
      return 3;
    default: {
      // Exhaustiveness check: a new ScoringSystem member with no case above
      // fails to compile here instead of silently falling through.
      const unhandled: never = scoringSystem;
      throw new Error(`unhandled scoringSystem: ${String(unhandled)}`);
    }
  }
}

// --- Game state ---------------------------------------------------------------

// Points needed to win a game outright — universal, not format-dependent (ad
// vs no-ad only changes whether a 2-point lead is required once both sides
// reach this many — see gameStateFor).
const POINTS_TO_WIN_GAME = 4;

export interface GameState {
  trackedPlayerPoints: number;
  opponentPoints: number;
  // trackedPlayerId, opponentId, or null while the game is still in progress.
  winner: string | null;
}

/**
 * Derives a game's current score and, once decided, its winner — from the
 * game's Points alone, not a stored fact. No Game class exists (and isn't
 * planned): who served, the running score, and the winner are all one small
 * grouping/counting step away from Point[], the same relationship
 * Point.rallyLength already has to its own recorded shots.
 *
 * `isAdScoring` is taken directly rather than a ScoringSystem — resolving
 * that is `isAdScoringFor`'s job, above, kept separate so this function
 * doesn't need to know ScoringSystem exists at all, just the one boolean
 * fact it actually needs.
 *
 * Assumes `points` is exactly one game's Points, in order, not extending
 * past the point (if any) that decided it — the same trust Point.create
 * places in whatever produced its input (see point.ts).
 */
export function gameStateFor(
  points: readonly Point[],
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
): GameState {
  const gameId = points[0]?.gameId;
  for (const point of points) {
    if (point.gameId !== gameId) {
      throw new Error("gameStateFor requires every point to share the same gameId");
    }
    if (point.trackedPlayerId !== trackedPlayerId || point.opponentId !== opponentId) {
      throw new Error("gameStateFor requires every point to match the given participants");
    }
  }

  const trackedPlayerPoints = points.filter((point) => point.winner === trackedPlayerId).length;
  const opponentPoints = points.filter((point) => point.winner === opponentId).length;

  const trackedPlayerLeads = trackedPlayerPoints - opponentPoints;
  const marginNeeded = isAdScoring ? 2 : 1;
  let winner: string | null = null;
  if (trackedPlayerPoints >= POINTS_TO_WIN_GAME && trackedPlayerLeads >= marginNeeded) {
    winner = trackedPlayerId;
  } else if (opponentPoints >= POINTS_TO_WIN_GAME && -trackedPlayerLeads >= marginNeeded) {
    winner = opponentId;
  }

  return { trackedPlayerPoints, opponentPoints, winner };
}
