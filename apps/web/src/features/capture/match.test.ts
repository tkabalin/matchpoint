import { describe, expect, test } from "vitest";

import { createMatch, Match } from "./match";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const PLAYED_ON = "2026-08-15";
const ROSTERED_OPPONENT = { opponentId: OPPONENT_ID };

describe("createMatch", () => {
  test("builds a Match from the given fields", () => {
    const match = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      "traditional",
      "hard",
    );

    expect(match.playedOn).toBe(PLAYED_ON);
    expect(match.trackedPlayerId).toBe(TRACKED_ID);
    expect(match.opponentId).toBe(OPPONENT_ID);
    expect(match.scoringSystem).toBe("traditional");
    expect(match.surfaceType).toBe("hard");
    expect(match.firstServer).toBe(TRACKED_ID);
  });

  test("generates a fresh matchId on every call", () => {
    const first = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
    const second = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);

    expect(first.matchId).not.toBe(second.matchId);
  });

  test("still runs Match.create's validation, e.g. rejects opponentId equal to trackedPlayerId", () => {
    expect(() =>
      createMatch(PLAYED_ON, TRACKED_ID, { opponentId: TRACKED_ID }, TRACKED_ID),
    ).toThrow("trackedPlayerId and opponentId must be different");
  });

  test("rejects an unknown surfaceType", () => {
    expect(() =>
      createMatch(
        PLAYED_ON,
        TRACKED_ID,
        ROSTERED_OPPONENT,
        TRACKED_ID,
        "traditional",
        // @ts-expect-error deliberately passing an invalid SurfaceType to test runtime validation
        "grass court",
      ),
    ).toThrow(/surfaceType/);
  });

  test("rejects a datetime string, not just a date — playedOn must match the backend's date-only played_on", () => {
    expect(() =>
      createMatch("2026-08-15T10:00:00.000Z", TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID),
    ).toThrow(/playedOn/);
  });

  test("rejects an unknown scoringSystem", () => {
    expect(() =>
      createMatch(
        PLAYED_ON,
        TRACKED_ID,
        ROSTERED_OPPONENT,
        TRACKED_ID,
        // @ts-expect-error deliberately passing an invalid ScoringSystem to test runtime validation
        "club_rules",
      ),
    ).toThrow(/scoringSystem/);
  });

  describe("defaults", () => {
    test("scoringSystem defaults to traditional when not given", () => {
      const match = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
      expect(match.scoringSystem).toBe("traditional");
    });

    test("surfaceType defaults to unspecified when not given", () => {
      const match = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
      expect(match.surfaceType).toBe("unspecified");
    });
  });

  describe("un-rostered opponent", () => {
    test("given an opponentId, opponentName is null — the name lives on that Player row", () => {
      const match = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
      expect(match.opponentName).toBeNull();
    });

    test("given an opponentName instead, generates a stand-in opponentId", () => {
      const match = createMatch(PLAYED_ON, TRACKED_ID, { opponentName: "Jane Rival" }, TRACKED_ID);

      expect(match.opponentName).toBe("Jane Rival");
      expect(match.opponentId).not.toBe("");
      expect(match.opponentId).not.toBe(TRACKED_ID);
    });

    test("generates a fresh stand-in opponentId on every call", () => {
      const first = createMatch(PLAYED_ON, TRACKED_ID, { opponentName: "Jane Rival" }, TRACKED_ID);
      const second = createMatch(PLAYED_ON, TRACKED_ID, { opponentName: "Jane Rival" }, TRACKED_ID);

      expect(first.opponentId).not.toBe(second.opponentId);
    });
  });
});

describe("Match.create opponentName validation", () => {
  test("rejects an empty opponentName", () => {
    expect(() =>
      Match.create({
        matchId: "match-1",
        playedOn: PLAYED_ON,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        opponentName: "",
        scoringSystem: "traditional",
        firstServer: TRACKED_ID,
        surfaceType: "hard",
      }),
    ).toThrow(/opponentName/);
  });
});

describe("Match.create firstServer validation", () => {
  test("accepts trackedPlayerId", () => {
    expect(() => createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID)).not.toThrow();
  });

  test("accepts opponentId — the opponent can serve first", () => {
    expect(() => createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, OPPONENT_ID)).not.toThrow();
  });

  test('rejects a firstServer that isn\'t a participant, e.g. the old "player"/"opponent" role label', () => {
    expect(() => createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, "player")).toThrow(
      /firstServer must be trackedPlayerId or opponentId/,
    );
  });
});

describe("Match.create surfaceType validation", () => {
  test("accepts unspecified as a real surfaceType, not just hard/clay/grass/carpet", () => {
    const match = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      "traditional",
      "unspecified",
    );
    expect(match.surfaceType).toBe("unspecified");
  });
});

describe("outcomeOverride", () => {
  test("defaults to null — a newly-started match hasn't ended", () => {
    const match = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
    expect(match.outcomeOverride).toBeNull();
  });

  test("createMatch accepts one — a back-filled match already known to have ended early", () => {
    const outcomeOverride = { reason: "retirement" as const, winner: OPPONENT_ID };
    const match = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      "traditional",
      "unspecified",
      outcomeOverride,
    );
    expect(match.outcomeOverride).toEqual(outcomeOverride);
  });

  test.each(["retirement", "walkover", "default"] as const)(
    "Match.create accepts %s as a reason",
    (reason) => {
      const match = createMatch(
        PLAYED_ON,
        TRACKED_ID,
        ROSTERED_OPPONENT,
        TRACKED_ID,
        "traditional",
        "unspecified",
        { reason, winner: TRACKED_ID },
      );
      expect(match.outcomeOverride).toEqual({ reason, winner: TRACKED_ID });
    },
  );

  test("Match.create rejects an unknown reason", () => {
    expect(() =>
      createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID, "traditional", "hard", {
        // @ts-expect-error deliberately passing an invalid MatchEndReason to test runtime validation
        reason: "injury",
        winner: TRACKED_ID,
      }),
    ).toThrow(/outcomeOverride.reason/);
  });

  test("Match.create rejects a winner that isn't a participant", () => {
    expect(() =>
      createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID, "traditional", "hard", {
        reason: "walkover",
        winner: "someone-else",
      }),
    ).toThrow(/outcomeOverride.winner/);
  });
});

describe("Match.fromJSON / toJSON", () => {
  test("round-trips through JSON", () => {
    const original = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);

    const rehydrated = Match.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));

    expect(rehydrated.toJSON()).toEqual(original.toJSON());
  });
});
