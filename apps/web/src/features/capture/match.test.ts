import { describe, expect, test } from "vitest";

import { createMatch, Match, maxSetsFor } from "./match";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const PLAYED_ON = "2026-08-15";

describe("createMatch", () => {
  test("builds a Match from the given fields", () => {
    const match = createMatch(PLAYED_ON, TRACKED_ID, OPPONENT_ID, "traditional", "hard", "player");

    expect(match.playedOn).toBe(PLAYED_ON);
    expect(match.trackedPlayerId).toBe(TRACKED_ID);
    expect(match.opponentId).toBe(OPPONENT_ID);
    expect(match.scoringSystem).toBe("traditional");
    expect(match.surfaceType).toBe("hard");
    expect(match.firstServer).toBe("player");
  });

  test("starts sets empty — a new match hasn't played any yet", () => {
    const match = createMatch(PLAYED_ON, TRACKED_ID, OPPONENT_ID, "traditional", "hard", "player");
    expect(match.sets).toEqual([]);
  });

  test("generates a fresh matchId on every call", () => {
    const first = createMatch(PLAYED_ON, TRACKED_ID, OPPONENT_ID, "traditional", "hard", "player");
    const second = createMatch(PLAYED_ON, TRACKED_ID, OPPONENT_ID, "traditional", "hard", "player");

    expect(first.matchId).not.toBe(second.matchId);
  });

  test("still runs Match.create's validation, e.g. rejects opponentId equal to trackedPlayerId", () => {
    expect(() =>
      createMatch(PLAYED_ON, TRACKED_ID, TRACKED_ID, "traditional", "hard", "player"),
    ).toThrow("trackedPlayerId and opponentId must be different");
  });

  test("rejects an unknown surfaceType", () => {
    expect(() =>
      createMatch(
        PLAYED_ON,
        TRACKED_ID,
        OPPONENT_ID,
        "traditional",
        // @ts-expect-error deliberately passing an invalid SurfaceType to test runtime validation
        "grass court",
        "player",
      ),
    ).toThrow(/surfaceType/);
  });

  test("rejects a datetime string, not just a date — playedOn must match the backend's date-only played_on", () => {
    expect(() =>
      createMatch(
        "2026-08-15T10:00:00.000Z",
        TRACKED_ID,
        OPPONENT_ID,
        "traditional",
        "hard",
        "player",
      ),
    ).toThrow(/playedOn/);
  });

  test("rejects an unknown scoringSystem", () => {
    expect(() =>
      createMatch(
        PLAYED_ON,
        TRACKED_ID,
        OPPONENT_ID,
        // @ts-expect-error deliberately passing an invalid ScoringSystem to test runtime validation
        "club_rules",
        "hard",
        "player",
      ),
    ).toThrow(/scoringSystem/);
  });
});

describe("maxSetsFor", () => {
  test.each([
    ["traditional", 3],
    ["mens_grand_slam", 5],
    ["womens_grand_slam", 3],
    ["no_ad_scoring", 3],
    ["match_tiebreak_10_points", 3],
    ["short_sets", 3],
    ["pro_set", 1],
    ["legacy", 3],
  ] as const)("%s's max sets is %i", (scoringSystem, expected) => {
    expect(maxSetsFor(scoringSystem)).toBe(expected);
  });
});

describe("Match.fromJSON / toJSON", () => {
  test("round-trips through JSON", () => {
    const original = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      OPPONENT_ID,
      "traditional",
      "hard",
      "player",
    );

    const rehydrated = Match.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));

    expect(rehydrated.toJSON()).toEqual(original.toJSON());
  });

  test("appending a set means building a new Match, not mutating the old one", () => {
    const original = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      OPPONENT_ID,
      "traditional",
      "hard",
      "player",
    );
    const newSet = {};

    const withSet = Match.create({ ...original.toJSON(), sets: [...original.sets, newSet] });

    expect(original.sets).toEqual([]);
    expect(withSet.sets).toEqual([newSet]);
  });
});

describe("immutability", () => {
  test("mutating toJSON()'s output does not affect the Match", () => {
    const match = createMatch(PLAYED_ON, TRACKED_ID, OPPONENT_ID, "traditional", "hard", "player");

    const snapshot = match.toJSON();
    snapshot.sets.push({});

    expect(match.sets).toEqual([]);
  });
});
