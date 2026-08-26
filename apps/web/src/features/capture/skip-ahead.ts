/**
 * Skipping capture ahead to a score already on the scoreboard.
 *
 * A score is never stored, only derived from points (see state.ts), so catching up to
 * one means producing the points that derive to it. Whatever's already been captured
 * for real stays exactly as it is — this only ever appends the points needed to bridge
 * from there to the target, never replaces or discards a real one. Each synthetic point
 * is recorded winner-only with an UNKNOWN serve, which is what marks it as a point
 * nobody watched rather than one that passes for real (see point.ts).
 *
 * Pure and I/O-free like the rest of the slice: ids and the base timestamp come from
 * the caller, the same convention `commitDraft` already has.
 */

import { Match } from "./match";
import { startNextPoint } from "./match-flow";
import { Point } from "./point";
import {
  deuceOrAdFromCounts,
  gameStateFor,
  isAdScoringFor,
  matchSetsFor,
  nextServerFor,
  otherIdOf,
  pointCallFor,
  resolveGameWinner,
} from "./state";

// Points won in the game in progress, as the scoreboard calls them. AD is only
// reachable at 4-3, which is why it can't be entered on both sides at once.
export const POINT_CALLS = ["0", "15", "30", "40", "AD"] as const;
export type PointCall = (typeof POINT_CALLS)[number];

export interface SkipAheadTarget {
  trackedGames: number;
  opponentGames: number;
  trackedPoints: PointCall;
  opponentPoints: PointCall;
  // Who serves the point capture resumes on.
  trackedServesNext: boolean;
}

const MAX_GAMES = 99;

// Raw won/lost point counts for a game still in progress — what gameStateFor returns
// stripped of its winner, since a game skip-ahead reasons about is by definition
// undecided. Shared by the two helpers below.
interface RawGamePoints {
  trackedPlayerPoints: number;
  opponentPoints: number;
}

/**
 * The order a run of wins has to arrive in for the thing they add up to to still be in
 * progress at the end: alternating while both sides have some left, then the remainder.
 * Used for points within a game and for games within a set, since four straight points
 * decide the one and six straight games decide the other.
 */
function alternated(trackedCount: number, opponentCount: number): boolean[] {
  const order: boolean[] = [];
  let tracked = trackedCount;
  let opponent = opponentCount;
  while (tracked > 0 && opponent > 0) {
    order.push(true, false);
    tracked -= 1;
    opponent -= 1;
  }
  for (let index = 0; index < tracked; index += 1) order.push(true);
  for (let index = 0; index < opponent; index += 1) order.push(false);
  return order;
}

export function validateTarget(target: SkipAheadTarget): string | null {
  for (const games of [target.trackedGames, target.opponentGames]) {
    if (!Number.isInteger(games) || games < 0 || games > MAX_GAMES) {
      return `Games must be a whole number between 0 and ${String(MAX_GAMES)}`;
    }
  }
  if (target.trackedPoints === "AD" && target.opponentPoints === "AD") {
    return "Only one side can hold advantage";
  }
  // Advantage is 4-3: the other side must be at 40 for it to be the score it claims.
  if (target.trackedPoints === "AD" && target.opponentPoints !== "40") {
    return "Advantage is only reachable at 40-40";
  }
  if (target.opponentPoints === "AD" && target.trackedPoints !== "40") {
    return "Advantage is only reachable at 40-40";
  }
  return null;
}

/**
 * Synthetic points that bridge the game already in progress to the target call — a
 * fresh climb from 0-0 if nothing real has been recorded in it yet, exactly like a
 * skip-ahead into an empty match always has. Once real points are involved, deuce
 * collapses many different raw counts onto the same three calls (deuce, ad-tracked,
 * ad-opponent), so from there this reasons in calls rather than raw counts, deciding
 * one synthetic point at a time which side needs it next, and refusing a target the
 * real score has already passed.
 */
function pointBridgeWinners(
  real: RawGamePoints,
  target: SkipAheadTarget,
  isAdScoring: boolean,
): boolean[] {
  if (real.trackedPlayerPoints === 0 && real.opponentPoints === 0) {
    return alternated(
      POINT_CALLS.indexOf(target.trackedPoints),
      POINT_CALLS.indexOf(target.opponentPoints),
    );
  }

  let trackedPlayerPoints = real.trackedPlayerPoints;
  let opponentPoints = real.opponentPoints;
  const winners: boolean[] = [];
  // Bounded by the state machine's own size — five calls, deuce cycling adds at most
  // a couple more steps — so a target that isn't reached by here isn't reachable.
  for (let step = 0; step < 10; step += 1) {
    const call = pointCallFor(trackedPlayerPoints, opponentPoints, isAdScoring);
    if (call.trackedPlayer === target.trackedPoints && call.opponent === target.opponentPoints) {
      return winners;
    }

    const deuceOrAd = deuceOrAdFromCounts(trackedPlayerPoints, opponentPoints, isAdScoring);
    let trackedWins: boolean;
    if (deuceOrAd !== null) {
      if (target.trackedPoints === "AD") trackedWins = true;
      else if (target.opponentPoints === "AD") trackedWins = false;
      else trackedWins = opponentPoints > trackedPlayerPoints; // levelling back to deuce
    } else {
      const targetTracked = POINT_CALLS.indexOf(target.trackedPoints);
      const targetOpponent = POINT_CALLS.indexOf(target.opponentPoints);
      if (trackedPlayerPoints < targetTracked) trackedWins = true;
      else if (opponentPoints < targetOpponent) trackedWins = false;
      else throw new Error("Target score can't be behind what's already been recorded");
    }

    winners.push(trackedWins);
    if (trackedWins) trackedPlayerPoints += 1;
    else opponentPoints += 1;
  }
  throw new Error("Target score can't be behind what's already been recorded");
}

/**
 * Synthetic points that decisively finish the game already in progress (or, from
 * 0-0, a fresh one) in `winnerIsTracked`'s favor. This is how the first of any
 * additional whole games gets built: it may have to inherit real points already
 * sitting in that game, unlike every game after it, which always starts clean.
 */
function decisiveGameBridge(
  real: RawGamePoints,
  winnerIsTracked: boolean,
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
): boolean[] {
  let trackedPlayerPoints = real.trackedPlayerPoints;
  let opponentPoints = real.opponentPoints;
  const winners: boolean[] = [];
  while (
    resolveGameWinner(
      trackedPlayerPoints,
      opponentPoints,
      trackedPlayerId,
      opponentId,
      isAdScoring,
    ) === null
  ) {
    winners.push(winnerIsTracked);
    if (winnerIsTracked) trackedPlayerPoints += 1;
    else opponentPoints += 1;
  }
  return winners;
}

/**
 * Who won each synthetic point to add, in order: if the target's game count is
 * already met, just the bridge to the target's point call; otherwise the games
 * still owed, with the first one inheriting whatever's real in the game already in
 * progress, the rest clean, and the target's point call bridged from a fresh game
 * after them — real points only ever exist in the game skip-ahead was called from.
 */
function deltaWinnersFor(
  target: SkipAheadTarget,
  realCurrentGame: RawGamePoints,
  deltaGamesTracked: number,
  deltaGamesOpponent: number,
  trackedPlayerId: string,
  opponentId: string,
  isAdScoring: boolean,
): boolean[] {
  if (deltaGamesTracked === 0 && deltaGamesOpponent === 0) {
    return pointBridgeWinners(realCurrentGame, target, isAdScoring);
  }

  const gameOrder = alternated(deltaGamesTracked, deltaGamesOpponent);
  const [firstGameWinner] = gameOrder;
  if (firstGameWinner === undefined) {
    // Unreachable: the branch above already returns when both deltas are 0, so
    // alternated() here always has at least one game to hand back.
    throw new Error("expected at least one additional game");
  }
  const restGameWinners = gameOrder.slice(1);
  return [
    ...decisiveGameBridge(
      realCurrentGame,
      firstGameWinner,
      trackedPlayerId,
      opponentId,
      isAdScoring,
    ),
    ...restGameWinners.flatMap((won) => [won, won, won, won]),
    ...alternated(
      POINT_CALLS.indexOf(target.trackedPoints),
      POINT_CALLS.indexOf(target.opponentPoints),
    ),
  ];
}

/**
 * The synthetic points to append so capture resumes from the target score, and the
 * match capture resumes on — unchanged unless the serve rotation has to be reseeded
 * (see below). `points` is the match's real log so far; every point in it is kept
 * exactly as recorded, never replaced.
 *
 * Throws on a target `validateTarget` rejects, on games or a point call the real
 * score has already passed (see the two bridge helpers above), or on a "serving
 * next" answer that conflicts with the real rotation once real points exist.
 */
export function skipAhead(
  match: Match,
  points: readonly Point[],
  target: SkipAheadTarget,
  makeId: () => string,
  timestamp: number,
): { match: Match; points: Point[] } {
  const invalid = validateTarget(target);
  if (invalid !== null) throw new Error(invalid);

  const isAdScoring = isAdScoringFor(match.scoringSystem);
  const liveSets = matchSetsFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );

  const realGamesTracked = liveSets.currentSet?.state.trackedPlayerGames ?? 0;
  const realGamesOpponent = liveSets.currentSet?.state.opponentGames ?? 0;
  const deltaGamesTracked = target.trackedGames - realGamesTracked;
  const deltaGamesOpponent = target.opponentGames - realGamesOpponent;
  if (deltaGamesTracked < 0 || deltaGamesOpponent < 0) {
    throw new Error("Target games can't be behind what's already been recorded");
  }

  const realCurrentGame: RawGamePoints =
    liveSets.currentSet === null
      ? { trackedPlayerPoints: 0, opponentPoints: 0 }
      : gameStateFor(
          points.slice(points.length - liveSets.currentSet.state.currentGamePoints),
          match.trackedPlayerId,
          match.opponentId,
          isAdScoring,
        );

  const winners = deltaWinnersFor(
    target,
    realCurrentGame,
    deltaGamesTracked,
    deltaGamesOpponent,
    match.trackedPlayerId,
    match.opponentId,
    isAdScoring,
  );

  const buildFor = (from: Match): Point[] => {
    const built: Point[] = [];
    for (const [index, won] of winners.entries()) {
      const { draft } = startNextPoint(from, [...points, ...built]);
      built.push(
        Point.create({
          ...draft,
          id: makeId(),
          timestamp: timestamp + index,
          serves: [{ number: 1, outcome: "UNKNOWN", location: null }],
          won,
          endReason: "UNUSUAL",
        }),
      );
    }
    return built;
  };

  const firstPass = buildFor(match);
  const desiredServer = target.trackedServesNext ? match.trackedPlayerId : match.opponentId;
  const liveSetsAfter = matchSetsFor(
    [...points, ...firstPass],
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );
  const servesNext = nextServerFor(
    liveSetsAfter,
    match.scoringSystem,
    match.firstServer,
    match.trackedPlayerId,
    match.opponentId,
  );
  if (servesNext === desiredServer) return { match, points: firstPass };

  // Reseeding rewrites who served every game from the first, which would contradict
  // the server already stored on any real point (see point.ts) — only safe with
  // none recorded yet, exactly the case skipAhead was originally built for.
  if (points.length > 0) {
    throw new Error("Serving next doesn't match the points already recorded");
  }
  const reseeded = Match.create({
    ...match.toJSON(),
    firstServer: otherIdOf(match.firstServer, match.trackedPlayerId, match.opponentId),
  });
  return { match: reseeded, points: buildFor(reseeded) };
}
