import { describe, expect, test } from "vitest";

import { createMatch } from "./match";
import type { Match } from "./match";
import { skipAhead, validateTarget } from "./skip-ahead";
import type { SkipAheadTarget } from "./skip-ahead";
import { nextServerFor, matchSetsFor, scoreboardFor } from "./state";
import type { Point } from "./point";

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

function scoreOf(points: readonly Point[], match: Match) {
  return scoreboardFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
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

describe("skipAhead — starting from nothing real", () => {
  test("the points it produces derive back to the score that was asked for", () => {
    const match = matchFor();
    const result = skipAhead(
      match,
      [],
      target({
        trackedGames: 3,
        opponentGames: 2,
        trackedPoints: "30",
        opponentPoints: "15",
        // 5 games played, alternating from firstServer, puts serve with the opponent.
        trackedServesNext: false,
      }),
      makeId,
      1_700_000_000_000,
    );

    expect(scoreOf(result.points, result.match)).toEqual({
      trackedPlayer: ["3", "30"],
      opponent: ["2", "15"],
    });
  });

  // Six straight games win a set. Emitting every tracked game before every opponent one
  // turned 6-5 into a finished 6-0 plus a second set at 0-5, and nothing rejected it.
  test.each([
    [6, 5, false],
    [5, 6, false],
    [7, 5, true],
    [5, 7, true],
  ])(
    "a set that runs long derives back to %i-%i, not a set that ended early",
    (tracked, opponent, trackedServesNext) => {
      const match = matchFor();
      const result = skipAhead(
        match,
        [],
        // trackedServesNext must agree with firstServer once total games played is
        // known (serve alternates each game) — an odd total puts serve with the
        // opponent.
        target({ trackedGames: tracked, opponentGames: opponent, trackedServesNext }),
        makeId,
        1_700_000_000_000,
      );

      const score = scoreOf(result.points, result.match);
      expect(score.trackedPlayer[0]).toBe(String(tracked));
      expect(score.opponent[0]).toBe(String(opponent));
    },
  );

  test("a score that really is a finished set still finishes it, at the right game", () => {
    const match = matchFor();
    const result = skipAhead(
      match,
      [],
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
      [],
      target({ trackedGames: 4, opponentGames: 4, trackedPoints: "AD", opponentPoints: "40" }),
      makeId,
      1_700_000_000_000,
    );

    expect(scoreOf(result.points, result.match)).toEqual({
      trackedPlayer: ["4", "AD"],
      opponent: ["4", "40"],
    });
  });

  test("every synthesised point is marked as one nobody watched", () => {
    const match = matchFor();
    const { points } = skipAhead(match, [], target({ trackedGames: 2 }), makeId, 1_700_000_000_000);

    expect(points).toHaveLength(8);
    for (const point of points) {
      expect(point.serves).toEqual([{ number: 1, outcome: "UNKNOWN", location: null }]);
      expect(point.endReason).toBe("UNUSUAL");
      expect(point.firstServeIn).toBeNull();
      expect(point.rallyLengthBucket).toBeNull();
    }
  });

  // firstServer is fixed, so only the "serving next" answer the game count already
  // implies (serve alternates each game) is accepted — see the refusal test below for
  // the other case.
  test.each([
    { games: 0, trackedServesNext: true },
    { games: 1, trackedServesNext: false },
  ])(
    "accepts serving next when it agrees with firstServer ($games games played)",
    ({ games, trackedServesNext }) => {
      const match = matchFor();
      const result = skipAhead(
        match,
        [],
        target({ trackedGames: games, trackedServesNext }),
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
    },
  );

  test("refuses a serving-next answer firstServer disagrees with, even with no real points yet", () => {
    // One game played puts the serve with the opponent already — asking for the
    // tracked player to serve next contradicts firstServer. firstServer is fixed at
    // match creation (see live-match.tsx) and never rewritten by skipAhead.
    expect(() =>
      skipAhead(
        matchFor(),
        [],
        target({ trackedGames: 1, trackedServesNext: true }),
        makeId,
        1_700_000_000_000,
      ),
    ).toThrow(/[Ss]erving next/);
  });

  test("a score that completes a set is recorded as a completed set", () => {
    const match = matchFor();
    const result = skipAhead(match, [], target({ trackedGames: 6 }), makeId, 1_700_000_000_000);

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
      skipAhead(matchFor(), [], target({ trackedGames: -1 }), makeId, 1_700_000_000_000),
    ).toThrow(/whole number/);
  });
});

describe("skipAhead — bridging from points already real", () => {
  test("keeps the real points exactly as recorded, only appending the gap", () => {
    const match = matchFor();
    const real = skipAhead(
      match,
      [],
      // One game played puts serve with the opponent.
      target({ trackedGames: 1, trackedServesNext: false }),
      makeId,
      1_700_000_000_000,
    ).points;

    const result = skipAhead(match, real, target({ trackedGames: 2 }), makeId, 1_700_000_100_000);

    // One more game's worth of points, not the whole match rebuilt from scratch.
    expect(result.points).toHaveLength(4);
    const combined = [...real, ...result.points];
    expect(combined.slice(0, real.length)).toEqual(real);
    expect(scoreOf(combined, match).trackedPlayer[0]).toBe("2");
  });

  test("bridges a partial, still-open game forward from the real points already in it", () => {
    const match = matchFor();
    // Real capture so far: tracked leads 15-0 in the game still in progress.
    const real = skipAhead(
      match,
      [],
      target({ trackedPoints: "15" }),
      makeId,
      1_700_000_000_000,
    ).points;
    expect(real).toHaveLength(1);

    const result = skipAhead(
      match,
      real,
      target({ trackedPoints: "40", opponentPoints: "15" }),
      makeId,
      1_700_000_100_000,
    );

    const combined = [...real, ...result.points];
    expect(combined.slice(0, real.length)).toEqual(real);
    expect(scoreOf(combined, match)).toEqual({ trackedPlayer: ["0", "40"], opponent: ["0", "15"] });
  });

  test("bridges advantage swapping sides through deuce, not by rewinding the real lead", () => {
    const match = matchFor();
    const real = skipAhead(
      match,
      [],
      target({ trackedPoints: "AD", opponentPoints: "40" }),
      makeId,
      1_700_000_000_000,
    ).points;

    const result = skipAhead(
      match,
      real,
      target({ trackedPoints: "40", opponentPoints: "AD" }),
      makeId,
      1_700_000_100_000,
    );

    const combined = [...real, ...result.points];
    expect(scoreOf(combined, match)).toEqual({ trackedPlayer: ["0", "40"], opponent: ["0", "AD"] });
  });

  test("refuses games behind what the real points already show", () => {
    const match = matchFor();
    const real = skipAhead(
      match,
      [],
      // Three games played puts serve with the opponent.
      target({ trackedGames: 3, trackedServesNext: false }),
      makeId,
      1_700_000_000_000,
    ).points;

    expect(() =>
      skipAhead(match, real, target({ trackedGames: 2 }), makeId, 1_700_000_100_000),
    ).toThrow(/behind what's already been recorded/);
  });

  test("refuses a point call the real points have already passed", () => {
    const match = matchFor();
    const real = skipAhead(
      match,
      [],
      target({ trackedPoints: "40" }),
      makeId,
      1_700_000_000_000,
    ).points;

    expect(() =>
      skipAhead(match, real, target({ trackedPoints: "15" }), makeId, 1_700_000_100_000),
    ).toThrow(/behind what's already been recorded/);
  });

  test("refuses a serving-next answer the real rotation disagrees with", () => {
    const match = matchFor();
    // Natural next server after one completed game is the opponent — asking for
    // false here keeps this real prefix built without needing a reseed itself.
    const real = skipAhead(
      match,
      [],
      target({ trackedGames: 1, trackedServesNext: false }),
      makeId,
      1_700_000_000_000,
    ).points;

    expect(() =>
      skipAhead(
        match,
        real,
        target({ trackedGames: 1, trackedPoints: "15", trackedServesNext: true }),
        makeId,
        1_700_000_100_000,
      ),
    ).toThrow(/[Ss]erving next/);
  });
});
