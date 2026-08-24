import { describe, expect, test } from "vitest";

import { createMatch } from "./match";
import { skipAhead, validateTarget } from "./skip-ahead";
import type { SkipAheadTarget } from "./skip-ahead";
import { nextServerFor, matchSetsFor, scoreboardFor } from "./state";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

function matchFor(scoringSystem: "traditional" | "no_ad_scoring" = "traditional") {
  return createMatch(
    "2026-08-24",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    TRACKED_ID,
    scoringSystem,
  );
}

function target(overrides: Partial<SkipAheadTarget> = {}): SkipAheadTarget {
  return {
    trackedGames: 0,
    opponentGames: 0,
    trackedPoints: "0",
    opponentPoints: "0",
    trackedServesNext: true,
    ...overrides,
  };
}

let counter = 0;
const makeId = () => `synthetic-${String((counter += 1))}`;

function scoreOf(result: { match: ReturnType<typeof matchFor>; points: unknown[] }) {
  return scoreboardFor(
    result.points as never,
    result.match.matchId,
    result.match.trackedPlayerId,
    result.match.opponentId,
    result.match.scoringSystem,
  );
}

describe("validateTarget", () => {
  test.each([-1, 100, 1.5])("rejects %s games", (games) => {
    expect(validateTarget(target({ trackedGames: games }))).toMatch(/whole number/);
  });

  test("rejects advantage on both sides at once", () => {
    expect(validateTarget(target({ trackedPoints: "AD", opponentPoints: "AD" }))).toMatch(
      /one side/,
    );
  });

  test("rejects advantage against anything but 40", () => {
    expect(validateTarget(target({ trackedPoints: "AD", opponentPoints: "30" }))).toMatch(/40-40/);
  });

  test("accepts a plain mid-set score", () => {
    expect(validateTarget(target({ trackedGames: 3, opponentGames: 2 }))).toBeNull();
  });
});

describe("skipAhead", () => {
  test("the points it produces derive back to the score that was asked for", () => {
    const match = matchFor();
    const result = skipAhead(
      match,
      target({ trackedGames: 3, opponentGames: 2, trackedPoints: "30", opponentPoints: "15" }),
      makeId,
      1_700_000_000_000,
    );

    expect(scoreOf(result)).toEqual({
      trackedPlayer: ["3", "30"],
      opponent: ["2", "15"],
    });
  });

  // Six straight games win a set. Emitting every tracked game before every opponent one
  // turned 6-5 into a finished 6-0 plus a second set at 0-5, and nothing rejected it.
  test.each([
    [6, 5],
    [5, 6],
    [7, 5],
    [5, 7],
  ])(
    "a set that runs long derives back to %i-%i, not a set that ended early",
    (tracked, opponent) => {
      const match = matchFor();
      const result = skipAhead(
        match,
        target({ trackedGames: tracked, opponentGames: opponent }),
        makeId,
        1_700_000_000_000,
      );

      const score = scoreOf(result);
      expect(score.trackedPlayer[0]).toBe(String(tracked));
      expect(score.opponent[0]).toBe(String(opponent));
    },
  );

  test("a score that really is a finished set still finishes it, at the right game", () => {
    const match = matchFor();
    const result = skipAhead(
      match,
      target({ trackedGames: 6, opponentGames: 4 }),
      makeId,
      1_700_000_000_000,
    );

    const { completedSets } = matchSetsFor(
      result.points,
      result.match.matchId,
      result.match.trackedPlayerId,
      result.match.opponentId,
      result.match.scoringSystem,
    );
    expect(completedSets).toHaveLength(1);
    expect(completedSets[0]?.trackedPlayerGames).toBe(6);
    expect(completedSets[0]?.opponentGames).toBe(4);
  });

  test("advantage survives the round trip — the game is still in progress at 4-3", () => {
    const match = matchFor();
    const result = skipAhead(
      match,
      target({ trackedGames: 4, opponentGames: 4, trackedPoints: "AD", opponentPoints: "40" }),
      makeId,
      1_700_000_000_000,
    );

    expect(scoreOf(result)).toEqual({
      trackedPlayer: ["4", "AD"],
      opponent: ["4", "40"],
    });
  });

  test("every synthesised point is marked as one nobody watched", () => {
    const match = matchFor();
    const { points } = skipAhead(match, target({ trackedGames: 2 }), makeId, 1_700_000_000_000);

    expect(points).toHaveLength(8);
    for (const point of points) {
      expect(point.serves).toEqual([{ number: 1, outcome: "UNKNOWN", location: null }]);
      expect(point.endReason).toBe("UNUSUAL");
      expect(point.firstServeIn).toBeNull();
      expect(point.rallyLengthBucket).toBeNull();
    }
  });

  test.each([true, false])("whoever the coach says serves next, does (%s)", (trackedServesNext) => {
    const match = matchFor();
    const result = skipAhead(
      match,
      target({ trackedGames: 3, opponentGames: 2, trackedServesNext }),
      makeId,
      1_700_000_000_000,
    );

    const liveSets = matchSetsFor(
      result.points,
      result.match.matchId,
      result.match.trackedPlayerId,
      result.match.opponentId,
      result.match.scoringSystem,
    );
    const servesNext = nextServerFor(
      liveSets,
      result.match.scoringSystem,
      result.match.firstServer,
      result.match.trackedPlayerId,
      result.match.opponentId,
    );

    expect(servesNext).toBe(trackedServesNext ? TRACKED_ID : OPPONENT_ID);
  });

  test("reseeding the rotation leaves the rest of the match alone", () => {
    // One game played puts the serve with the opponent already, so asking for the
    // tracked player to serve next is what forces the seed to move.
    const match = matchFor();
    const result = skipAhead(
      match,
      target({ trackedGames: 1, trackedServesNext: true }),
      makeId,
      1_700_000_000_000,
    );

    expect(match.firstServer).toBe(TRACKED_ID);
    expect(result.match.firstServer).toBe(OPPONENT_ID);
    expect(result.match.matchId).toBe(match.matchId);
    expect(result.match.scoringSystem).toBe(match.scoringSystem);
    expect(result.match.trackedPlayerId).toBe(match.trackedPlayerId);
  });

  test("a score that completes a set is recorded as a completed set", () => {
    const match = matchFor();
    const result = skipAhead(match, target({ trackedGames: 6 }), makeId, 1_700_000_000_000);

    const { completedSets } = matchSetsFor(
      result.points,
      result.match.matchId,
      result.match.trackedPlayerId,
      result.match.opponentId,
      result.match.scoringSystem,
    );
    expect(completedSets).toHaveLength(1);
    expect(completedSets[0]?.winner).toBe(TRACKED_ID);
  });

  test("refuses a target it cannot produce rather than producing a different score", () => {
    expect(() =>
      skipAhead(matchFor(), target({ trackedGames: -1 }), makeId, 1_700_000_000_000),
    ).toThrow(/whole number/);
  });
});
