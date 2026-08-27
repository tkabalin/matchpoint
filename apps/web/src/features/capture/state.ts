/**
 * The rules of the format, resolved from a `ScoringSystem`.
 *
 * This module — and everything else under `features/capture/` — is a network-free
 * zone: the capture path must never await I/O. ESLint enforces that at the root
 * config; see the `features/capture` block in `eslint.config.mjs`.
 *
 * This is the "flow" layer the domain model (match.ts, match-set.ts, point.ts)
 * deliberately stays out of: those classes store already-decided facts and validate
 * their own shape, but never decide what happens next. What a format's rules actually
 * are — ad or no-ad, how many games win a set, where a breaker starts — belongs here.
 *
 * Composing those rules into a running score belongs one level up, in `score.ts`,
 * which folds the match's event log over them. This module knows nothing about that
 * fold and never imports it, which is what keeps the dependency one-way.
 */

import type { Match, ScoringSystem } from "./match";
import type { MatchSet } from "./match-set";

// --- ScoringSystem-derived rules ---------------------------------------------
//
// ScoringSystem itself (match.ts) is stored data — decided once at Match,
// threaded down unchanged. What a given value actually *means* for how a
// game or set plays out is a flow decision, not a storage fact, so it lives
// here instead: each of these is the single place its mapping is made, same
// convention as Point/Match's own xFor(y) helpers.

/**
 * Whether a ScoringSystem plays with ad (win a game at deuce by 2 clear
 * points) or no-ad (sudden death at 40-40) scoring — the one axis a game's
 * win condition needs.
 *
 * "short_sets" is confirmed always no-ad, not merely inferred — official ITF Fast4
 * rules bundle short sets, no-ad scoring, and sudden-death breakers together as one
 * fixed package, not an independent choice (see docs/scoring-systems.md).
 */
export function isAdScoringFor(scoringSystem: ScoringSystem): boolean {
  switch (scoringSystem) {
    case "no_ad_scoring":
    case "short_sets":
      return false;
    case "traditional":
    case "mens_grand_slam":
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
 * "traditional" and "legacy" are both confirmed best-of-3 — see
 * docs/scoring-systems.md. "legacy" isn't stated there directly (advantage sets
 * historically ran at both best-of-3 and best-of-5 depending on the event); best-of-3
 * is chosen for this app's amateur/club focus, where it's the standard.
 */
export function maxSetsFor(scoringSystem: ScoringSystem): number {
  switch (scoringSystem) {
    case "mens_grand_slam":
      return 5;
    case "pro_set":
      return 1;
    case "traditional":
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

// --- Game rules ---------------------------------------------------------------

// Points needed to win a game outright — universal, not format-dependent (ad
// vs no-ad only changes whether a 2-point lead is required once both sides
// reach this many — see resolveGameWinner).
const POINTS_TO_WIN_GAME = 4;

/**
 * The win-condition math a game's score resolves to — the single place the ad/no-ad
 * margin lives, whatever is counting the two point totals up to it.
 *
 * The two participant arguments are labels, not necessarily ids: `score.ts` folds in
 * "TRACKED"/"OPPONENT" roles and gets a role back, while a caller holding real ids
 * gets an id back. Either way this function only ever returns one of the two it was
 * handed.
 */
export function resolveGameWinner<T>(
  trackedPlayerPoints: number,
  opponentPoints: number,
  trackedPlayerId: T,
  opponentId: T,
  isAdScoring: boolean,
): T | null {
  const trackedPlayerLeads = trackedPlayerPoints - opponentPoints;
  const marginNeeded = isAdScoring ? 2 : 1;
  if (trackedPlayerPoints >= POINTS_TO_WIN_GAME && trackedPlayerLeads >= marginNeeded) {
    return trackedPlayerId;
  }
  if (opponentPoints >= POINTS_TO_WIN_GAME && -trackedPlayerLeads >= marginNeeded) {
    return opponentId;
  }
  return null;
}

// --- Set rules ------------------------------------------------------------------

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
 * mens_grand_slam uses a 7-point breaker in regular sets
 * but a 10-point breaker in the decider, and match_tiebreak_10_points
 * replaces the decider with a single breaker outright — gamesToWin: 0,
 * no games phase to play at all.
 *
 * short_sets' tiebreakTarget (5) is confirmed against official ITF Fast4 rules: a
 * first-to-5, win-by-2 breaker, the same structure as a full-length tiebreak, just
 * shorter. pro_set's games-to-win is confirmed at 8 (docs/scoring-systems.md states
 * "8 (or 10)" without resolving which) — 8 is the club-level convention, chosen for
 * this app's amateur/club focus rather than left coach-configurable.
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

// --- Match rules ----------------------------------------------------------------

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
 * from sets won alone.
 *
 * Scope: this only ever answers "who's ahead on sets, and has someone won
 * enough of them." Retirement, walkover, and default all end a match with
 * a winner who may not lead on sets at all — matchStateFor has no way to
 * represent any of them, and can't: it derives purely from MatchSet[],
 * and none of those three are visible there. Don't treat this function's
 * winner as final without checking Match.outcomeOverride first (see
 * match.ts) — when it's set, it short-circuits this derivation entirely,
 * not something reconciled here.
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

// Flips between the two participant ids — exported for match-flow.ts's retireMatch,
// which needs the flip (a retirement's winner is the other participant) without this
// function assuming `id` is already one of the two; that's the caller's check.
export function otherIdOf(id: string, trackedPlayerId: string, opponentId: string): string {
  return id === trackedPlayerId ? opponentId : trackedPlayerId;
}

/**
 * The match's real, final winner — `matchStateFor`'s own doc comment warns its
 * winner isn't final until `Match.outcomeOverride` is checked separately; this is
 * that check, so a caller can't forget it. Falls back to set-based derivation only
 * when there's no override, and composes matchRulesFor/matchStateFor rather than
 * duplicating either. `matchSets` is meant to be the completed sets alone —
 * an in-progress set has no `winner` at all, so it's excluded by construction, the
 * same way matchStateFor already treats an unfinished set as not counting toward
 * either side.
 */
export function finalWinnerFor(match: Match, matchSets: readonly MatchSet[]): string | null {
  if (match.outcomeOverride !== null) {
    return match.outcomeOverride.winner;
  }
  const rules = matchRulesFor(match.scoringSystem);
  return matchStateFor(matchSets, match.trackedPlayerId, match.opponentId, rules).winner;
}

// --- Point call display -----------------------------------------------------------

// The call for 0, 1, or 2 points won — 3+ moves into deuce/AD territory, resolved by
// pointCallFor below since that depends on the opponent's count too.
const POINT_LABELS = ["0", "15", "30"] as const;

/**
 * DEUCE, or advantage to whoever leads by exactly 1 — null before 40-40, or whenever
 * isAdScoring is false (no-ad sudden death never distinguishes a deuce point from any
 * other 40-40 tie, the game ends the instant either side leads by 1). pointCallFor's
 * own intermediate step, and the score editor's, which needs the same distinction to
 * offer an AD chip only where the format plays one.
 */
export function deuceOrAdFromCounts(
  trackedPlayerPoints: number,
  opponentPoints: number,
  isAdScoring: boolean,
): "DEUCE" | "AD_TRACKED" | "AD_OPPONENT" | null {
  if (!isAdScoring || trackedPlayerPoints < 3 || opponentPoints < 3) return null;
  const lead = trackedPlayerPoints - opponentPoints;
  if (lead === 0) return "DEUCE";
  return lead > 0 ? "AD_TRACKED" : "AD_OPPONENT";
}

/**
 * The live call for a game still in progress — "40", "AD", or one of POINT_LABELS,
 * one per side. Takes the raw point counts rather than a Point[] slice — this just
 * turns a count into what an umpire would actually call.
 *
 * Assumes the game is genuinely undecided (resolveGameWinner would return null) — the
 * scoreboard only ever calls this on the match's current, unfinished game.
 */
export function pointCallFor(
  trackedPlayerPoints: number,
  opponentPoints: number,
  isAdScoring: boolean,
): { trackedPlayer: string; opponent: string } {
  const label = (points: number) => (points < 3 ? POINT_LABELS[points] : undefined) ?? "40";

  const deuceOrAd = deuceOrAdFromCounts(trackedPlayerPoints, opponentPoints, isAdScoring);
  if (deuceOrAd === null) {
    // No-ad sudden death never goes past "40" apiece — the game ends the instant
    // either side leads by 1, so both at "40" is the only reachable undecided state.
    return { trackedPlayer: label(trackedPlayerPoints), opponent: label(opponentPoints) };
  }
  if (deuceOrAd === "DEUCE") return { trackedPlayer: "40", opponent: "40" };
  return deuceOrAd === "AD_TRACKED"
    ? { trackedPlayer: "AD", opponent: "40" }
    : { trackedPlayer: "40", opponent: "AD" };
}
