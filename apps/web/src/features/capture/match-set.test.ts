import { describe, expect, test } from "vitest";

import { MatchSet } from "./match-set";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

/** A minimal, valid raw MatchSet payload — override just the fields a test cares about. */
function matchSetData(overrides: Record<string, unknown> = {}) {
  return {
    matchId: MATCH_ID,
    setNumber: 1,
    trackedPlayerId: TRACKED_ID,
    opponentId: OPPONENT_ID,
    trackedPlayerGames: 6,
    opponentGames: 4,
    tiebreak: null,
    winner: TRACKED_ID,
    ...overrides,
  };
}

describe("MatchSet.create structural validation", () => {
  test("accepts a minimal valid set", () => {
    expect(() => MatchSet.create(matchSetData())).not.toThrow();
  });

  test.each([
    ["non-object input", "not an object"],
    ["null input", null],
  ])("rejects %s", (_label, input) => {
    expect(() => MatchSet.create(input)).toThrow();
  });

  test.each([0, -1, 1.5])("rejects a setNumber of %s", (setNumber) => {
    expect(() => MatchSet.create(matchSetData({ setNumber }))).toThrow(/setNumber/);
  });

  test.each(["matchId", "trackedPlayerId", "opponentId"])("rejects an empty %s", (field) => {
    expect(() => MatchSet.create(matchSetData({ [field]: "" }))).toThrow();
  });

  test("rejects trackedPlayerId equal to opponentId", () => {
    expect(() => MatchSet.create(matchSetData({ opponentId: TRACKED_ID }))).toThrow(
      "trackedPlayerId and opponentId must be different",
    );
  });

  test.each(["trackedPlayerGames", "opponentGames"])("rejects a negative %s", (field) => {
    expect(() => MatchSet.create(matchSetData({ [field]: -1 }))).toThrow();
  });

  test.each(["trackedPlayerGames", "opponentGames"])("rejects a non-integer %s", (field) => {
    expect(() => MatchSet.create(matchSetData({ [field]: 6.5 }))).toThrow();
  });

  test("accepts a null winner — the set is still in progress", () => {
    const set = MatchSet.create(
      matchSetData({ winner: null, trackedPlayerGames: 3, opponentGames: 2 }),
    );
    expect(set.winner).toBeNull();
  });

  test("rejects a winner that isn't a participant", () => {
    expect(() => MatchSet.create(matchSetData({ winner: "someone-else" }))).toThrow();
  });
});

describe("MatchSet.create tiebreak validation", () => {
  test("accepts a null tiebreak — the set wasn't decided by a breaker", () => {
    const set = MatchSet.create(matchSetData({ tiebreak: null }));
    expect(set.tiebreak).toBeNull();
  });

  test("accepts a valid tiebreak score", () => {
    const tiebreak = { trackedPlayerPoints: 7, opponentPoints: 5, target: 7 };
    const set = MatchSet.create(matchSetData({ tiebreak }));
    expect(set.tiebreak).toEqual(tiebreak);
  });

  test("accepts the match_tiebreak_10_points degenerate case: 0/0 games, tiebreak decides it", () => {
    const set = MatchSet.create(
      matchSetData({
        trackedPlayerGames: 0,
        opponentGames: 0,
        tiebreak: { trackedPlayerPoints: 10, opponentPoints: 7, target: 10 },
      }),
    );
    expect(set.trackedPlayerGames).toBe(0);
    expect(set.opponentGames).toBe(0);
    expect(set.tiebreak).toEqual({ trackedPlayerPoints: 10, opponentPoints: 7, target: 10 });
  });

  test("rejects a non-object, non-null tiebreak", () => {
    expect(() => MatchSet.create(matchSetData({ tiebreak: "not an object" }))).toThrow(
      /tiebreak must be an object/,
    );
  });

  test.each(["trackedPlayerPoints", "opponentPoints"])(
    "rejects a negative tiebreak.%s",
    (field) => {
      const tiebreak = { trackedPlayerPoints: 7, opponentPoints: 5, target: 7, [field]: -1 };
      expect(() => MatchSet.create(matchSetData({ tiebreak }))).toThrow(`tiebreak.${field}`);
    },
  );

  test.each([0, -1, 1.5])("rejects a tiebreak.target of %s", (target) => {
    const tiebreak = { trackedPlayerPoints: 7, opponentPoints: 5, target };
    expect(() => MatchSet.create(matchSetData({ tiebreak }))).toThrow(/tiebreak\.target/);
  });
});

describe("MatchSet.fromJSON / toJSON", () => {
  test("round-trips through JSON", () => {
    const original = MatchSet.create(matchSetData());

    const rehydrated = MatchSet.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));

    expect(rehydrated.toJSON()).toEqual(original.toJSON());
  });
});
