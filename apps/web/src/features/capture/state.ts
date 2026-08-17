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

import type { Point } from "./point";

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
 * `isAdScoring` is taken directly rather than a ScoringSystem, to keep this
 * function's dependencies minimal — resolving ScoringSystem into concrete
 * rules like this is deferred work (see the TODO on MatchSet), and whichever
 * caller eventually does that resolution should be the only place it happens.
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
