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

import type { Match, ScoringSystem } from "./match";
import { MatchSet } from "./match-set";
import type { TiebreakScore } from "./match-set";
import type { CourtSide, Point } from "./point";

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
// reach this many — see resolveGameWinner).
const POINTS_TO_WIN_GAME = 4;

export interface GameState {
  trackedPlayerPoints: number;
  opponentPoints: number;
  // trackedPlayerId, opponentId, or null while the game is still in progress.
  winner: string | null;
}

/**
 * The win-condition math a game's score resolves to — shared by gameStateFor's own
 * batch tally and setStateFor's incremental one, so the ad/no-ad margin logic lives in
 * exactly one place regardless of how the two points are counted up to it.
 */
function resolveGameWinner(
  trackedPlayerPoints: number,
  opponentPoints: number,
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
): string | null {
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

/**
 * Derives a game's current score and, once decided, its winner — from the
 * game's Points alone, not a stored fact. No Game class exists (and isn't
 * planned): who served, the running score, and the winner are all one small
 * grouping/counting step away from Point[].
 *
 * `isAdScoring` is taken directly rather than a ScoringSystem — resolving
 * that is `isAdScoringFor`'s job, above, kept separate so this function
 * doesn't need to know ScoringSystem exists at all, just the one boolean
 * fact it actually needs.
 *
 * Assumes `points` is exactly one game's Points, in `sequence` order, not
 * extending past the point (if any) that decided it — a Point no longer
 * carries a gameId to check that against, so this only verifies ordering
 * (see point.ts's module doc comment for why gameId was dropped).
 */
export function gameStateFor(
  points: readonly Point[],
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
): GameState {
  let lastSequence = -Infinity;
  for (const point of points) {
    if (point.sequence < lastSequence) {
      throw new Error("gameStateFor requires points in non-decreasing sequence order");
    }
    lastSequence = point.sequence;
  }

  const trackedPlayerPoints = points.filter((point) => point.won).length;
  const opponentPoints = points.filter((point) => !point.won).length;
  const winner = resolveGameWinner(
    trackedPlayerPoints,
    opponentPoints,
    trackedPlayerId,
    opponentId,
    isAdScoring,
  );

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

// Whether a set at this game score has entered (or, for the gamesToWin: 0 degenerate
// case, always is) the breaker — the single place this condition is computed, so
// setStateFor's own loop and the exported isTiebreakFor below can't drift apart.
function isTiebreakAt(trackedPlayerGames: number, opponentGames: number, rules: SetRules): boolean {
  if (rules.gamesToWin === 0) return true;
  return (
    rules.tiebreakAt !== null &&
    trackedPlayerGames === rules.tiebreakAt &&
    opponentGames === rules.tiebreakAt
  );
}

export interface SetState {
  trackedPlayerGames: number;
  opponentGames: number;
  tiebreak: TiebreakScore | null;
  // trackedPlayerId, opponentId, or null while the set is still in progress.
  winner: string | null;
  // Points played in the current, not-yet-decided game — 0 whenever no game is in
  // progress (a fresh set, a game that just completed, or mid-tiebreak, where
  // `tiebreak`'s own point counts are the equivalent fact instead). Exposes what
  // setStateFor's own walk already tracks internally and otherwise discards —
  // deuceOrAdFor needs it to know how far into the current game a point sits.
  currentGamePoints: number;
}

/**
 * Whether the *next* point in this set is a tiebreak point. Not simply
 * `state.tiebreak !== null` — at games-all with zero breaker points played yet,
 * `tiebreak` is still null (setStateFor only builds a TiebreakScore once a breaker
 * point has actually been recorded), but the next point must still follow tiebreak
 * serving rules. Derives straight from the game score instead, via the same
 * isTiebreakAt setStateFor's own loop uses.
 */
export function isTiebreakFor(state: SetState, rules: SetRules): boolean {
  return isTiebreakAt(state.trackedPlayerGames, state.opponentGames, rules);
}

/**
 * Derives a set's current score and, once decided, its winner — from the
 * set's Points alone, same relationship gameStateFor has to a game. A Point
 * carries no gameId and no tiebreak flag (see point.ts's module doc
 * comment), so membership in a game — and whether the breaker has started —
 * isn't a stored fact to group by. Instead this replays `points` in order,
 * tracking a running per-game point tally and resolving it through the same
 * resolveGameWinner gameStateFor uses, switching into the breaker once both
 * sides' credited games reach `rules.tiebreakAt`.
 *
 * `isAdScoring` stays a standalone parameter, same decoupling reason
 * gameStateFor already has it rather than a ScoringSystem.
 *
 * A normally-decided breaker set credits the winner an extra game (7-6),
 * tennis' own convention for how it's recorded. The gamesToWin: 0
 * degenerate case (match_tiebreak_10_points' decider) starts in the
 * breaker immediately and never credits a game at all — trackedPlayerGames/
 * opponentGames stay 0-0, since there's no games phase to credit from.
 * That's correct storage, but must never reach the coach's screen rendered
 * literally — see the field comment on
 * MatchSet.trackedPlayerGames/opponentGames for the display convention.
 *
 * Assumes `points` is exactly one set's Points, in `sequence` order, not
 * extending past the point (if any) that decided it — same trust
 * gameStateFor places in its own input.
 */
export function setStateFor(
  points: readonly Point[],
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
  rules: SetRules,
): SetState {
  let trackedPlayerGames = 0;
  let opponentGames = 0;
  let currentGameTrackedPoints = 0;
  let currentGameOpponentPoints = 0;
  const tiebreakPoints: Point[] = [];
  let inTiebreak = isTiebreakAt(0, 0, rules);

  // Tally completed games from a running per-game point count — not a winner decided
  // mid-walk, which would wrongly lock one in from an early lead ahead of games that
  // still complete for the other side later in the same points array (see the final
  // tally below, which decides the set's own winner exactly once).
  let lastSequence = -Infinity;
  for (const point of points) {
    if (point.sequence < lastSequence) {
      throw new Error("setStateFor requires points in non-decreasing sequence order");
    }
    lastSequence = point.sequence;

    if (inTiebreak) {
      tiebreakPoints.push(point);
      continue;
    }

    if (point.won) {
      currentGameTrackedPoints += 1;
    } else {
      currentGameOpponentPoints += 1;
    }
    const gameWinner = resolveGameWinner(
      currentGameTrackedPoints,
      currentGameOpponentPoints,
      trackedPlayerId,
      opponentId,
      isAdScoring,
    );
    if (gameWinner === null) {
      continue;
    }

    if (gameWinner === trackedPlayerId) {
      trackedPlayerGames += 1;
    } else {
      opponentGames += 1;
    }
    currentGameTrackedPoints = 0;
    currentGameOpponentPoints = 0;

    if (isTiebreakAt(trackedPlayerGames, opponentGames, rules)) {
      // Tied at the tiebreak threshold — the rest of the set is the breaker, not more games.
      inTiebreak = true;
    }
  }

  let tiebreak: TiebreakScore | null = null;
  if (tiebreakPoints.length > 0) {
    tiebreak = {
      trackedPlayerPoints: tiebreakPoints.filter((point) => point.won).length,
      opponentPoints: tiebreakPoints.filter((point) => !point.won).length,
      target: rules.tiebreakTarget,
    };
  }

  // Second pass: decide the winner once, from the final tallies — same win-condition
  // math gameStateFor uses for a game, one level up.
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
    return {
      trackedPlayerGames,
      opponentGames,
      tiebreak,
      winner,
      currentGamePoints: currentGameTrackedPoints + currentGameOpponentPoints,
    };
  }

  const gamesLead = trackedPlayerGames - opponentGames;
  if (trackedPlayerGames >= rules.gamesToWin && gamesLead >= 2) {
    winner = trackedPlayerId;
  } else if (opponentGames >= rules.gamesToWin && -gamesLead >= 2) {
    winner = opponentId;
  } else if (tiebreak !== null) {
    // Not decided by games alone — the breaker decides instead.
    const tiebreakLead = tiebreak.trackedPlayerPoints - tiebreak.opponentPoints;
    if (tiebreak.trackedPlayerPoints >= tiebreak.target && tiebreakLead >= 2) {
      winner = trackedPlayerId;
      trackedPlayerGames += 1;
    } else if (tiebreak.opponentPoints >= tiebreak.target && -tiebreakLead >= 2) {
      winner = opponentId;
      opponentGames += 1;
    }
  }

  return {
    trackedPlayerGames,
    opponentGames,
    tiebreak,
    winner,
    currentGamePoints: currentGameTrackedPoints + currentGameOpponentPoints,
  };
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

// --- Whole-match derivation -----------------------------------------------------
//
// Everything above answers "what's the score of one game/set" given exactly that
// game's or set's Points already sliced out. Nothing yet turns a whole match's flat,
// ordered Point[] into that slicing — these three functions close that gap.
//
// TODO: deuce vs ad court isn't derived anywhere yet — which service box is in
// play alternates by point number within the game (point 1 deuce, 2 ad, 3 deuce, ...,
// same rule through deuce/advantage under ad scoring), purely arithmetic from how
// many points have been played in the current game so far. Worth adding once
// there's a caller for it (analytics on serve placement needs it — "wide" points
// from the deuce and ad courts go in opposite physical directions, so lumping them
// together silently mixes two different tendencies).

export interface MatchSetsState {
  completedSets: MatchSet[];
  // The in-progress set's own live state — trackedPlayerGames/opponentGames/tiebreak
  // so far, winner always null (a decided set moves to completedSets instead). Null
  // only when the match's last point exactly completed a set and no point has been
  // recorded for the next one yet — NOT for a brand-new, zero-point match, where set
  // 1 genuinely is the current set at 0-0 from the first instant.
  currentSet: { setNumber: number; state: SetState } | null;
}

/**
 * Slices a match's flat, ordered `Point[]` into its sets — the composing step
 * `setStateFor` itself can't do, since a Point carries no setId (see point.ts's
 * module doc comment) any more than it carries a gameId. Re-probes `setStateFor`
 * after every point rather than in bigger chunks, because there's no other way to
 * find a set boundary — `setStateFor` requires its input to be *exactly* one set's
 * points, so the only way to find where that boundary falls is to keep asking.
 * Quadratic in a set's own point count, not the whole match's — accepted here the
 * same way setStateFor already accepts it one level down for games, and for the
 * same reason: a phone-scale capture path, not a hot loop (see web-capture.md).
 *
 * Trusts the input past a mathematically-decided match, same convention
 * gameStateFor/setStateFor already have — it isn't this function's job to guess
 * whether a caller should still be recording points; it just answers "given these
 * points, what happened." Supplying points for a set beyond `maxSets` surfaces
 * setRulesFor's own existing "setNumber cannot exceed maxSets" error, unchanged.
 */
export function matchSetsFor(
  points: readonly Point[],
  matchId: string,
  trackedPlayerId: string,
  opponentId: string,
  scoringSystem: ScoringSystem,
): MatchSetsState {
  const isAdScoring = isAdScoringFor(scoringSystem);
  const maxSets = maxSetsFor(scoringSystem);

  let setNumber = 1;
  let buffer: Point[] = [];
  const completedSets: MatchSet[] = [];
  let currentSetState: SetState | null = null;
  let lastSequence = -Infinity;

  for (const point of points) {
    if (point.matchId !== matchId) {
      throw new Error("matchSetsFor requires every point to belong to the given match");
    }
    if (point.sequence < lastSequence) {
      throw new Error("matchSetsFor requires points in non-decreasing sequence order");
    }
    lastSequence = point.sequence;

    buffer.push(point);
    const rules = setRulesFor(scoringSystem, setNumber, maxSets);
    currentSetState = setStateFor(buffer, trackedPlayerId, opponentId, isAdScoring, rules);
    if (currentSetState.winner !== null) {
      completedSets.push(
        MatchSet.create({
          matchId,
          setNumber,
          trackedPlayerId,
          opponentId,
          trackedPlayerGames: currentSetState.trackedPlayerGames,
          opponentGames: currentSetState.opponentGames,
          tiebreak: currentSetState.tiebreak,
          winner: currentSetState.winner,
        }),
      );
      buffer = [];
      currentSetState = null;
      setNumber += 1;
    }
  }

  if (currentSetState === null) {
    if (completedSets.length === 0) {
      const rules = setRulesFor(scoringSystem, 1, maxSets);
      return {
        completedSets,
        currentSet: {
          setNumber: 1,
          state: setStateFor([], trackedPlayerId, opponentId, isAdScoring, rules),
        },
      };
    }
    return { completedSets, currentSet: null };
  }

  return { completedSets, currentSet: { setNumber, state: currentSetState } };
}

// Flips between the two participant ids — the building block server rotation is
// built from, since "whose turn" always means "not whoever had it last." Exported
// for match-flow.ts's retireMatch, which needs the same flip (a retirement's winner
// is the other participant) but not this function's assumption that `id` is already
// one of the two — that's checked by whichever caller needs it checked.
export function otherIdOf(id: string, trackedPlayerId: string, opponentId: string): string {
  return id === trackedPlayerId ? opponentId : trackedPlayerId;
}

// Who serves the game at this 0-indexed position, counted across the whole match —
// a completed tiebreak counts as exactly one such position, same as a regular game
// (see nextServerFor's own comment on why that's always safe to assume).
function serverForGameIndex(
  gameIndex: number,
  firstServer: string,
  trackedPlayerId: string,
  opponentId: string,
): string {
  return gameIndex % 2 === 0 ? firstServer : otherIdOf(firstServer, trackedPlayerId, opponentId);
}

// How many alternation "slots" a completed set consumed — the real game count for a
// set decided without a breaker, or that count already including tennis' own device
// for recording a breaker as one game (see nextServerFor's own comment). The one
// exception is match_tiebreak_10_points' decider, which never credits a game at all
// (see setStateFor) despite still consuming exactly one slot.
function alternationSlotsForCompletedSet(matchSet: MatchSet, rules: SetRules): number {
  return rules.gamesToWin === 0 ? 1 : matchSet.trackedPlayerGames + matchSet.opponentGames;
}

/**
 * Who serves the next point — the input `capture-flow.startPoint`'s own `server`
 * parameter needs, which this codebase doesn't derive anywhere else.
 *
 * The key fact making this tractable: a completed set's `trackedPlayerGames +
 * opponentGames` already equals its true alternation-slot count, tiebreak or not.
 * A set decided without a breaker (6-3) sums to the real game count (9), one slot
 * each. A set decided by one (6-6 → breaker, stored as 7-6 per setStateFor's own
 * "credit the winner an extra game" convention) sums to 13 — the 12 real games plus
 * one slot for the breaker itself, which standard tennis service rotation treats as
 * a single game regardless of how many points it took. Both conventions record the
 * breaker as "one game," so the two counts coincide by construction, and no
 * was-there-a-tiebreak branching is needed for a *completed* set — except
 * match_tiebreak_10_points' decider, whose games stay 0/0 even once decided
 * (setStateFor never credits a game there at all), hence
 * `alternationSlotsForCompletedSet`'s own special case.
 *
 * Inside a *live* tiebreak, rotation is local to it: the player who'd have served
 * that game slot serves point 1 alone, then serve alternates every 2 points after —
 * point 1 → A, 2-3 → B, 4-5 → A, 6-7 → B, .... `floor(pointNumber / 2) % 2 === 0`
 * is that pattern's closed form (verified by hand against points 1 through 8).
 *
 * Never checks whether the match has already ended — it always answers "who serves
 * the next point," trusting the caller only to ask when one is actually expected.
 * Whether the match is over is `finalWinnerFor`'s question, not this one.
 */
export function nextServerFor(
  liveSets: MatchSetsState,
  scoringSystem: ScoringSystem,
  firstServer: string,
  trackedPlayerId: string,
  opponentId: string,
): string {
  const maxSets = maxSetsFor(scoringSystem);

  let cumulativeSlots = 0;
  for (const set of liveSets.completedSets) {
    const rules = setRulesFor(scoringSystem, set.setNumber, maxSets);
    cumulativeSlots += alternationSlotsForCompletedSet(set, rules);
  }

  if (liveSets.currentSet === null) {
    return serverForGameIndex(cumulativeSlots, firstServer, trackedPlayerId, opponentId);
  }

  const { setNumber, state } = liveSets.currentSet;
  const rules = setRulesFor(scoringSystem, setNumber, maxSets);
  cumulativeSlots += state.trackedPlayerGames + state.opponentGames;

  if (!isTiebreakFor(state, rules)) {
    return serverForGameIndex(cumulativeSlots, firstServer, trackedPlayerId, opponentId);
  }

  const tiebreakFirstServer = serverForGameIndex(
    cumulativeSlots,
    firstServer,
    trackedPlayerId,
    opponentId,
  );
  const pointsPlayed =
    state.tiebreak === null
      ? 0
      : state.tiebreak.trackedPlayerPoints + state.tiebreak.opponentPoints;
  const nextPointNumber = pointsPlayed + 1;
  const firstServerServesNext = Math.floor(nextPointNumber / 2) % 2 === 0;
  return firstServerServesNext
    ? tiebreakFirstServer
    : otherIdOf(tiebreakFirstServer, trackedPlayerId, opponentId);
}

// Deuce court on an even count of points played so far (0, 2, 4, ... -> deuce; 1, 3,
// 5, ... -> ad) — the standard tennis service-position pattern, unconditional even
// through extended deuce in ad scoring, and identical inside a tiebreak (service
// position still alternates by points played, just within the breaker instead of a
// game).
function boxFor(pointsPlayed: number): CourtSide {
  return pointsPlayed % 2 === 0 ? "DEUCE" : "AD";
}

/**
 * Which service box the next point is served from. Never a fact to record — fully
 * determined by how many points have already been played in the current game (or,
 * mid-tiebreak, the breaker so far), the same way `ServeZone`/`CourtZone`'s `box`/
 * `half` fields are themselves recorded facts about a point already played, not
 * derived ones (see point.ts). A fresh, not-yet-started set (no current set at all)
 * is game 1, point 1: always the deuce court.
 */
export function nextBoxFor(liveSets: MatchSetsState, scoringSystem: ScoringSystem): CourtSide {
  if (liveSets.currentSet === null) {
    return boxFor(0);
  }

  const { setNumber, state } = liveSets.currentSet;
  const maxSets = maxSetsFor(scoringSystem);
  const rules = setRulesFor(scoringSystem, setNumber, maxSets);

  if (isTiebreakFor(state, rules)) {
    const pointsPlayed =
      state.tiebreak === null
        ? 0
        : state.tiebreak.trackedPlayerPoints + state.tiebreak.opponentPoints;
    return boxFor(pointsPlayed);
  }

  return boxFor(state.currentGamePoints);
}

/**
 * The match's real, final winner — `matchStateFor`'s own doc comment warns its
 * winner isn't final until `Match.outcomeOverride` is checked separately; this is
 * that check, so a caller can't forget it. Falls back to set-based derivation only
 * when there's no override, and composes matchRulesFor/matchStateFor rather than
 * duplicating either. `matchSets` is meant to be `MatchSetsState.completedSets` —
 * an in-progress current set has no `winner` at all, so it's excluded by
 * construction, the same way matchStateFor already treats an unfinished set as not
 * counting toward either side.
 */
export function finalWinnerFor(match: Match, matchSets: readonly MatchSet[]): string | null {
  if (match.outcomeOverride !== null) {
    return match.outcomeOverride.winner;
  }
  const rules = matchRulesFor(match.scoringSystem);
  return matchStateFor(matchSets, match.trackedPlayerId, match.opponentId, rules).winner;
}
