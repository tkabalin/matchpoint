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
import type { MatchSet, TiebreakScore } from "./match-set";
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

// --- Set state ------------------------------------------------------------------

/**
 * A set's concrete rules for one particular position in the match — several
 * systems vary by whether this is the deciding set (see setRulesFor's own
 * doc comment), so setNumber/maxSets are required, not just scoringSystem.
 */
export interface SetRules {
  gamesToWin: number;
  // null = no tiebreak ever (legacy's deciding set plays on past 6-6 until
  // someone leads by 2 games). Ignored when gamesToWin is 0 (the
  // match_tiebreak_10_points degenerate case, below) — there's no games
  // phase for a tiebreak-at threshold to apply to.
  tiebreakAt: number | null;
  // Points needed to win the breaker. Meaningless when tiebreakAt is null.
  tiebreakTarget: number;
}

/**
 * Resolves a set's concrete rules from its ScoringSystem and position in
 * the match.
 *
 * `maxSets` means total sets playable — maxSetsFor's own return value, e.g.
 * best-of-5 is 5, not the 3 needed to win. Using "needed to win" here would
 * make `setNumber === maxSets` true for set 3 of a five-setter, silently
 * treating it as the decider and resolving the wrong tiebreakTarget for
 * every Grand Slam match — and best-of-3-only tests wouldn't catch it,
 * since the two definitions coincide there.
 *
 * Several systems are position-dependent, not just legacy:
 * mens_grand_slam/womens_grand_slam use a 7-point breaker in regular sets
 * but a 10-point breaker in the decider, and match_tiebreak_10_points
 * replaces the decider with a single breaker outright — gamesToWin: 0,
 * no games phase to play at all.
 *
 * TODO: confirm against the brief/BBD. short_sets' tiebreakTarget isn't in
 * the reference table at all — 5 is Fast4's common convention, not
 * confirmed. pro_set's games-to-win is stated as "8 (or 10)" with no
 * target given; defaulting to the more common 8-game/7-point convention.
 */
export function setRulesFor(
  scoringSystem: ScoringSystem,
  setNumber: number,
  maxSets: number,
): SetRules {
  if (!Number.isInteger(setNumber) || setNumber < 1) {
    throw new Error("setNumber must be a positive integer");
  }
  if (!Number.isInteger(maxSets) || maxSets < 1) {
    throw new Error("maxSets must be a positive integer");
  }
  if (setNumber > maxSets) {
    throw new Error(`setNumber (${setNumber}) cannot exceed maxSets (${maxSets})`);
  }
  const isDecidingSet = setNumber === maxSets;

  switch (scoringSystem) {
    case "match_tiebreak_10_points":
      return isDecidingSet
        ? { gamesToWin: 0, tiebreakAt: 0, tiebreakTarget: 10 }
        : { gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 7 };
    case "mens_grand_slam":
    case "womens_grand_slam":
      return { gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: isDecidingSet ? 10 : 7 };
    case "legacy":
      return { gamesToWin: 6, tiebreakAt: isDecidingSet ? null : 6, tiebreakTarget: 7 };
    case "traditional":
    case "no_ad_scoring":
      return { gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 7 };
    case "short_sets":
      return { gamesToWin: 4, tiebreakAt: 3, tiebreakTarget: 5 };
    case "pro_set":
      return { gamesToWin: 8, tiebreakAt: 8, tiebreakTarget: 7 };
    default: {
      // Exhaustiveness check: a new ScoringSystem member with no case above
      // fails to compile here instead of silently falling through.
      const unhandled: never = scoringSystem;
      throw new Error(`unhandled scoringSystem: ${String(unhandled)}`);
    }
  }
}

export interface SetState {
  trackedPlayerGames: number;
  opponentGames: number;
  tiebreak: TiebreakScore | null;
  // trackedPlayerId, opponentId, or null while the set is still in progress.
  winner: string | null;
}

/**
 * Derives a set's current score and, once decided, its winner — from the
 * set's Points alone, same relationship gameStateFor has to a game. Groups
 * the non-tiebreak points by gameId and runs gameStateFor on each to tally
 * completed games; separately tallies any tiebreak-flagged points into a
 * TiebreakScore.
 *
 * `isAdScoring` stays a standalone parameter, same decoupling reason
 * gameStateFor already has it rather than a ScoringSystem.
 *
 * Once both sides reach `rules.tiebreakAt` games, the winner isn't
 * decidable from games alone — it's decided by the breaker instead. A
 * normally-decided breaker set credits the winner an extra game (7-6),
 * tennis' own convention for how it's recorded. The gamesToWin: 0
 * degenerate case (match_tiebreak_10_points' decider) never credits a
 * game at all — trackedPlayerGames/opponentGames stay 0-0, since there's
 * no games phase to credit from. That's correct storage, but must never
 * reach the coach's screen rendered literally — see the field comment on
 * MatchSet.trackedPlayerGames/opponentGames for the display convention.
 *
 * Assumes `points` is exactly one set's Points, in order, not extending
 * past the point (if any) that decided it — same trust gameStateFor
 * places in its own input.
 */
export function setStateFor(
  points: readonly Point[],
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
  rules: SetRules,
): SetState {
  for (const point of points) {
    if (point.trackedPlayerId !== trackedPlayerId || point.opponentId !== opponentId) {
      throw new Error("setStateFor requires every point to match the given participants");
    }
  }

  const tiebreakPoints = points.filter((point) => point.isTiebreakPoint);
  const regularPoints = points.filter((point) => !point.isTiebreakPoint);

  // Group regular points by gameId, preserving first-seen order, and tally
  // each completed game's winner via gameStateFor.
  const gameIds: string[] = [];
  const pointsByGame = new Map<string, Point[]>();
  for (const point of regularPoints) {
    let gamePoints = pointsByGame.get(point.gameId);
    if (gamePoints === undefined) {
      gamePoints = [];
      gameIds.push(point.gameId);
      pointsByGame.set(point.gameId, gamePoints);
    }
    gamePoints.push(point);
  }

  let trackedPlayerGames = 0;
  let opponentGames = 0;
  for (const gameId of gameIds) {
    const gameState = gameStateFor(
      pointsByGame.get(gameId) ?? [],
      trackedPlayerId,
      opponentId,
      isAdScoring,
    );
    if (gameState.winner === trackedPlayerId) {
      trackedPlayerGames += 1;
    } else if (gameState.winner === opponentId) {
      opponentGames += 1;
    }
    // Still in progress (winner: null) — don't count it either way.
  }

  let tiebreak: TiebreakScore | null = null;
  if (tiebreakPoints.length > 0) {
    tiebreak = {
      trackedPlayerPoints: tiebreakPoints.filter((point) => point.winner === trackedPlayerId)
        .length,
      opponentPoints: tiebreakPoints.filter((point) => point.winner === opponentId).length,
      target: rules.tiebreakTarget,
    };
  }

  let winner: string | null = null;

  if (rules.gamesToWin === 0) {
    // Degenerate case: decided purely by the breaker, games never played.
    if (tiebreak !== null) {
      const tiebreakLead = tiebreak.trackedPlayerPoints - tiebreak.opponentPoints;
      if (tiebreak.trackedPlayerPoints >= tiebreak.target && tiebreakLead >= 2) {
        winner = trackedPlayerId;
      } else if (tiebreak.opponentPoints >= tiebreak.target && -tiebreakLead >= 2) {
        winner = opponentId;
      }
    }
    return { trackedPlayerGames, opponentGames, tiebreak, winner };
  }

  const gamesLead = trackedPlayerGames - opponentGames;
  if (trackedPlayerGames >= rules.gamesToWin && gamesLead >= 2) {
    winner = trackedPlayerId;
  } else if (opponentGames >= rules.gamesToWin && -gamesLead >= 2) {
    winner = opponentId;
  } else if (
    rules.tiebreakAt !== null &&
    trackedPlayerGames === rules.tiebreakAt &&
    opponentGames === rules.tiebreakAt &&
    tiebreak !== null
  ) {
    // Tied at the tiebreak threshold — decided by the breaker, not games.
    const tiebreakLead = tiebreak.trackedPlayerPoints - tiebreak.opponentPoints;
    if (tiebreak.trackedPlayerPoints >= tiebreak.target && tiebreakLead >= 2) {
      winner = trackedPlayerId;
      trackedPlayerGames += 1;
    } else if (tiebreak.opponentPoints >= tiebreak.target && -tiebreakLead >= 2) {
      winner = opponentId;
      opponentGames += 1;
    }
  }

  return { trackedPlayerGames, opponentGames, tiebreak, winner };
}

// --- Match state ----------------------------------------------------------------

export interface MatchRules {
  setsToWin: number;
  // Total sets playable (maxSetsFor's own value) — setRulesFor needs this
  // exact number, not re-derived, to know which set is the decider.
  maxSets: number;
}

/**
 * A match's set-count rules: how many sets to win it outright, and the
 * total sets playable.
 *
 * Both come from one resolver rather than leaving `setsToWin * 2 - 1`
 * (or the reverse) inline at call sites — get that arithmetic wrong once
 * and a caller silently mis-identifies the deciding set, the exact
 * failure mode setRulesFor's own setNumber/maxSets check already guards
 * against one level down. setsToWin is `(maxSets + 1) / 2`, exact integer
 * division, not a rounding guess — a match can't end in a tie, so
 * maxSetsFor's value is always odd.
 */
export function matchRulesFor(scoringSystem: ScoringSystem): MatchRules {
  const maxSets = maxSetsFor(scoringSystem);
  return { setsToWin: (maxSets + 1) / 2, maxSets };
}

export interface MatchState {
  trackedPlayerSets: number;
  opponentSets: number;
  // trackedPlayerId, opponentId, or null while the match is still
  // undecided by set count alone — see the scope note below.
  winner: string | null;
}

/**
 * Derives a match's current set score and, once decided, its winner —
 * from sets won alone, same relationship setStateFor has to games.
 *
 * Scope: this only ever answers "who's ahead on sets, and has someone won
 * enough of them." Retirement, walkover, and default all end a match with
 * a winner who may not lead on sets at all — matchStateFor has no way to
 * represent any of them, and can't: it derives purely from MatchSet[],
 * and none of those three are visible there. Don't treat this function's
 * winner as final without checking for one of those overrides first — as
 * a match-record-level field that short-circuits this derivation
 * entirely, not something resolved here.
 */
export function matchStateFor(
  matchSets: readonly MatchSet[],
  trackedPlayerId: string,
  opponentId: string,
  rules: MatchRules,
): MatchState {
  for (const matchSet of matchSets) {
    if (matchSet.trackedPlayerId !== trackedPlayerId || matchSet.opponentId !== opponentId) {
      throw new Error("matchStateFor requires every set to match the given participants");
    }
  }

  const trackedPlayerSets = matchSets.filter((set) => set.winner === trackedPlayerId).length;
  const opponentSets = matchSets.filter((set) => set.winner === opponentId).length;

  let winner: string | null = null;
  if (trackedPlayerSets >= rules.setsToWin) {
    winner = trackedPlayerId;
  } else if (opponentSets >= rules.setsToWin) {
    winner = opponentId;
  }

  return { trackedPlayerSets, opponentSets, winner };
}
