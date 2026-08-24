/**
 * Skipping capture ahead to a score already on the scoreboard.
 *
 * A score is never stored, only derived from points (see state.ts), so there is nothing
 * to write: reaching 3-2, 30-15 means producing the points that derive to it. Each one
 * is recorded winner-only with an UNKNOWN serve, which is what marks it as a point
 * nobody watched rather than one that passes for real (see point.ts).
 *
 * Pure and I/O-free like the rest of the slice: ids and the base timestamp come from
 * the caller, the same convention `commitDraft` already has.
 */

import { Match } from "./match";
import { startNextPoint } from "./match-flow";
import { Point } from "./point";
import { matchSetsFor, nextServerFor, otherIdOf } from "./state";

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

/**
 * Who won each point to synthesise, in order: the completed games, four points apiece,
 * then the game in progress.
 *
 * Games alternate for the same reason points do, one level up. Six straight games win a
 * set, so playing every tracked game before every opponent one turned 6-5 into a
 * finished 6-0 and a second set at 0-5. Alternating keeps the set in progress until the
 * score genuinely ends it, and a score that really is a completed set (6-4, 7-5) still
 * completes at the right game.
 */
function winnersFor(target: SkipAheadTarget): boolean[] {
  const trackedPoints = POINT_CALLS.indexOf(target.trackedPoints);
  const opponentPoints = POINT_CALLS.indexOf(target.opponentPoints);
  return [
    ...alternated(target.trackedGames, target.opponentGames).flatMap((won) => [won, won, won, won]),
    ...alternated(trackedPoints, opponentPoints),
  ];
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
 * The match and points capture resumes from. `Match.firstServer` may come back flipped:
 * who serves next is derived from the games played, so the only way to honour the
 * coach's answer is to move the seed the rotation counts from. Everything else about
 * the match is untouched.
 *
 * Throws on a target `validateTarget` rejects, rather than quietly producing a score
 * that isn't the one asked for.
 */
export function skipAhead(
  match: Match,
  target: SkipAheadTarget,
  makeId: () => string,
  timestamp: number,
): { match: Match; points: Point[] } {
  const invalid = validateTarget(target);
  if (invalid !== null) throw new Error(invalid);

  const winners = winnersFor(target);
  const build = (from: Match) => {
    const points: Point[] = [];
    for (const [index, won] of winners.entries()) {
      const { draft } = startNextPoint(from, points);
      points.push(
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
    return points;
  };

  const firstPass = build(match);
  const desiredServer = target.trackedServesNext ? match.trackedPlayerId : match.opponentId;
  const liveSets = matchSetsFor(
    firstPass,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );
  const servesNext = nextServerFor(
    liveSets,
    match.scoringSystem,
    match.firstServer,
    match.trackedPlayerId,
    match.opponentId,
  );
  if (servesNext === desiredServer) return { match, points: firstPass };

  // Reseeded, so every synthesised point's own server is rebuilt against the rotation
  // that will actually apply rather than the one that was flipped out from under it.
  const reseeded = Match.create({
    ...match.toJSON(),
    firstServer: otherIdOf(match.firstServer, match.trackedPlayerId, match.opponentId),
  });
  return { match: reseeded, points: build(reseeded) };
}
