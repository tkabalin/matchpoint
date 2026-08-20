import { describe, expect, test } from "vitest";

import {
  isMatchOver,
  nextSequenceFor,
  nextServerRoleFor,
  retireMatch,
  startNextPoint,
  voidPoint,
} from "./match-flow";
import { createMatch } from "./match";
import type { MatchOutcomeOverride, ScoringSystem } from "./match";
import { Point } from "./point";
import { matchSetsFor } from "./state";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

// Monotonically increasing across the whole file, same convention as state.test.ts —
// only relative order within one test's own array matters.
let nextSequence = 0;

/** A won point, minimal otherwise. `sequence` defaults to the shared counter. */
function pointWonBy(matchId: string, winner: string, sequence?: number) {
  const resolvedSequence = sequence ?? nextSequence++;
  return Point.create({
    id: `point-${crypto.randomUUID()}`,
    matchId,
    timestamp: 1_700_000_000_000 + resolvedSequence,
    sequence: resolvedSequence,
    server: "TRACKED",
    serves: [{ number: 1, outcome: "IN", location: { box: "DEUCE", target: "T" } }],
    returnOutcome: null,
    won: winner === TRACKED_ID,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "MID" },
    rallyLengthBucket: null,
  });
}

/** `count` clean 4-0 games in a row, all won by `winner`. */
function completedGames(matchId: string, winner: string, count: number) {
  return Array.from({ length: count * 4 }, () => pointWonBy(matchId, winner));
}

/** A minimal Match via createMatch — override just what a test cares about. */
function matchOf(
  scoringSystem: ScoringSystem = "traditional",
  firstServer: string = TRACKED_ID,
  outcomeOverride: MatchOutcomeOverride | null = null,
) {
  return createMatch(
    "2024-01-01",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    firstServer,
    scoringSystem,
    "unspecified",
    outcomeOverride,
  );
}

describe("nextSequenceFor", () => {
  test("empty points -> 0", () => {
    expect(nextSequenceFor([])).toBe(0);
  });

  test("contiguous points -> last + 1", () => {
    const points = completedGames(MATCH_ID, TRACKED_ID, 1); // sequences 0-3
    expect(nextSequenceFor(points)).toBe(4);
  });

  test("a gap left by a void -> max + 1, not points.length", () => {
    // Simulates the state after voiding sequence 3 out of an original 0-5 run.
    const points = [0, 1, 2, 4, 5].map((sequence) => pointWonBy(MATCH_ID, TRACKED_ID, sequence));
    expect(nextSequenceFor(points)).toBe(6);
    expect(nextSequenceFor(points)).not.toBe(points.length); // length is 5 — would collide with 5
  });
});

describe("nextServerRoleFor", () => {
  test("translates the tracked player's id to TRACKED", () => {
    const match = matchOf();
    const liveSets = {
      completedSets: [],
      currentSet: {
        setNumber: 1,
        state: {
          trackedPlayerGames: 0,
          opponentGames: 0,
          tiebreak: null,
          winner: null,
          currentGamePoints: 0,
        },
      },
    };
    // 0 games completed, firstServer = trackedPlayerId -> tracked serves.
    expect(nextServerRoleFor(liveSets, match)).toBe("TRACKED");
  });

  test("translates the opponent's id to OPPONENT", () => {
    const match = matchOf();
    const liveSets = {
      completedSets: [],
      currentSet: {
        setNumber: 1,
        state: {
          trackedPlayerGames: 1,
          opponentGames: 0,
          tiebreak: null,
          winner: null,
          currentGamePoints: 0,
        },
      },
    };
    // 1 game completed -> odd -> flips from firstServer (tracked) to the opponent.
    expect(nextServerRoleFor(liveSets, match)).toBe("OPPONENT");
  });
});

describe("startNextPoint", () => {
  test("brand-new match, zero points", () => {
    const match = matchOf();
    const state = startNextPoint(match, []);
    expect(state.step).toEqual({ name: "SERVE", number: 1 });
    expect(state.draft.matchId).toBe(match.matchId);
    expect(state.draft.sequence).toBe(0);
    expect(state.draft.server).toBe("TRACKED"); // firstServer defaults to trackedPlayerId
  });

  test("mid-match points: sequence and server against hardcoded expected values", () => {
    // Explicit sequences 0-3, not the shared auto-incrementing counter — this test's
    // expected values are hardcoded below, so they must be independent of whatever
    // sequence range earlier tests in this file already consumed. Hardcoded, and not
    // re-derived via nextSequenceFor/nextServerRoleFor, so a bug in what
    // startNextPoint composes is actually caught: comparing its output to those same
    // helpers' own output couldn't catch a bug inside them, since both sides would be
    // wrong identically.
    const match = matchOf();
    const points = [0, 1, 2, 3].map((sequence) => pointWonBy(match.matchId, TRACKED_ID, sequence));
    const state = startNextPoint(match, points);

    // 4 points, one game credited to the tracked player — 4 is the next sequence,
    // and 1 completed game is an odd alternation count, flipping serve to the opponent.
    expect(state.draft.sequence).toBe(4);
    expect(state.draft.server).toBe("OPPONENT");
    expect(state.step).toEqual({ name: "SERVE", number: 1 });
  });
});

describe("voidPoint", () => {
  test("removes exactly the matching point, others untouched and in order", () => {
    const points = completedGames(MATCH_ID, TRACKED_ID, 1);
    const target = points[1];
    if (target === undefined) throw new Error("fixture must have a second point");

    const result = voidPoint(points, target.id);
    expect(result.map((point) => point.id)).toEqual([points[0]?.id, points[2]?.id, points[3]?.id]);
  });

  test("throws when the id isn't present", () => {
    const points = completedGames(MATCH_ID, TRACKED_ID, 1);
    expect(() => voidPoint(points, "not-a-real-id")).toThrow(/no point with id/);
  });

  test("re-running matchSetsFor on the post-void array recomputes a different, correct score", () => {
    const points = completedGames(MATCH_ID, TRACKED_ID, 2); // 2 clean games, 2-0
    const before = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(before.currentSet?.state.trackedPlayerGames).toBe(2);

    const first = points[0];
    if (first === undefined) throw new Error("fixture must have a first point");

    // Voiding one point out of the first game leaves it a point short, so only the
    // second game is still credited.
    const afterVoid = voidPoint(points, first.id);
    const after = matchSetsFor(afterVoid, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(after.currentSet?.state.trackedPlayerGames).toBe(1);
  });
});

describe("retireMatch", () => {
  test("tracked player retires -> opponent wins", () => {
    const match = matchOf();
    const retired = retireMatch(match, match.trackedPlayerId);
    expect(retired.outcomeOverride).toEqual({ reason: "retirement", winner: match.opponentId });
  });

  test("opponent retires -> tracked player wins", () => {
    const match = matchOf();
    const retired = retireMatch(match, match.opponentId);
    expect(retired.outcomeOverride).toEqual({
      reason: "retirement",
      winner: match.trackedPlayerId,
    });
  });

  test("rejects a retiredPlayerId that isn't a participant", () => {
    const match = matchOf();
    expect(() => retireMatch(match, "someone-else")).toThrow(
      /must be trackedPlayerId or opponentId/,
    );
  });

  test("the original match is unaffected", () => {
    const match = matchOf();
    retireMatch(match, match.trackedPlayerId);
    expect(match.outcomeOverride).toBeNull();
  });
});

describe("isMatchOver", () => {
  test("true immediately when outcomeOverride is set, even with zero points", () => {
    const match = matchOf("traditional", TRACKED_ID, { reason: "retirement", winner: OPPONENT_ID });
    expect(isMatchOver(match, [])).toBe(true);
  });

  test("true once points decide the match by straight sets", () => {
    const match = matchOf();
    const points = [
      ...completedGames(match.matchId, OPPONENT_ID, 4),
      ...completedGames(match.matchId, TRACKED_ID, 6), // set 1: tracked 6-4
      ...completedGames(match.matchId, OPPONENT_ID, 2),
      ...completedGames(match.matchId, TRACKED_ID, 6), // set 2: tracked 6-2 — match over, 2-0
    ];
    expect(isMatchOver(match, points)).toBe(true);
  });

  test("false mid-match", () => {
    const match = matchOf();
    const points = completedGames(match.matchId, TRACKED_ID, 1);
    expect(isMatchOver(match, points)).toBe(false);
  });
});
