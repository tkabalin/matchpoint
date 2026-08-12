import { describe, expect, test } from "vitest";

import { Point } from "./point";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

/** A minimal, valid raw Point payload — override just the fields a test cares about. */
function pointData(overrides: Record<string, unknown> = {}) {
  return {
    id: "point-1",
    gameId: "game-1",
    trackedPlayerId: TRACKED_ID,
    opponentId: OPPONENT_ID,
    serveNumber: "first",
    outcome: "win",
    winner: TRACKED_ID,
    server: TRACKED_ID,
    trackedPlayerShots: [],
    opponentShots: null,
    winBy: null,
    lossBy: null,
    ...overrides,
  };
}

describe("Point.create structural validation", () => {
  test("accepts a minimal valid point", () => {
    expect(() => Point.create(pointData())).not.toThrow();
  });

  test.each([
    ["non-object input", "not an object"],
    ["null input", null],
  ])("rejects %s", (_label, input) => {
    expect(() => Point.create(input)).toThrow();
  });

  test.each(["id", "gameId", "trackedPlayerId", "opponentId"])("rejects an empty %s", (field) => {
    expect(() => Point.create(pointData({ [field]: "" }))).toThrow();
  });

  test("rejects trackedPlayerId equal to opponentId", () => {
    expect(() => Point.create(pointData({ opponentId: TRACKED_ID }))).toThrow(
      "trackedPlayerId and opponentId must be different",
    );
  });

  test("rejects an unknown serveNumber", () => {
    expect(() => Point.create(pointData({ serveNumber: "third" }))).toThrow(/serveNumber/);
  });

  test("rejects an unknown outcome", () => {
    expect(() => Point.create(pointData({ outcome: "ace" }))).toThrow(/outcome/);
  });

  test.each(["winner", "server"])("rejects a %s that isn't a participant", (field) => {
    expect(() => Point.create(pointData({ [field]: "someone-else" }))).toThrow();
  });

  test("rejects a trackedPlayerShots entry with an unknown shot type", () => {
    expect(() => Point.create(pointData({ trackedPlayerShots: ["smash"] }))).toThrow(
      "trackedPlayerShots",
    );
  });

  test("rejects an opponentShots entry with an unknown shot type", () => {
    expect(() => Point.create(pointData({ opponentShots: ["smash"] }))).toThrow("opponentShots");
  });

  test("accepts opponentShots as an empty array, distinct from null", () => {
    const point = Point.create(pointData({ opponentShots: [] }));
    expect(point.opponentDataComplete).toBe(true);
    expect(point.opponentShots).toEqual([]);
  });

  test.each(["winBy", "lossBy"])("rejects a malformed %s tuple", (field) => {
    expect(() => Point.create(pointData({ [field]: ["forced_error", "forehand"] }))).toThrow();
    expect(() =>
      Point.create(pointData({ [field]: ["not_an_error_type", "forehand", null] })),
    ).toThrow();
    expect(() =>
      Point.create(pointData({ [field]: ["forced_error", "not_a_shot", null] })),
    ).toThrow();
  });

  test("accepts a winBy tuple with a reason", () => {
    const point = Point.create(pointData({ winBy: ["forced_error", "forehand", "net"] }));
    expect(point.winBy).toEqual(["forced_error", "forehand", "net"]);
  });
});

describe("Point.fromJSON / toJSON", () => {
  test("round-trips through JSON", () => {
    const original = Point.create(
      pointData({ trackedPlayerShots: ["forehand", "backhand"], opponentShots: ["slice"] }),
    );

    const rehydrated = Point.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));

    expect(rehydrated.toJSON()).toEqual(original.toJSON());
  });
});

describe("immutability", () => {
  test("mutating the input array after create() does not affect the Point", () => {
    const shots = ["forehand"];
    const point = Point.create(pointData({ trackedPlayerShots: shots }));

    shots.push("backhand");

    expect(point.trackedPlayerShots).toEqual(["forehand"]);
  });

  test("mutating toJSON()'s output does not affect the Point", () => {
    const point = Point.create(pointData({ trackedPlayerShots: ["forehand"] }));

    const snapshot = point.toJSON();
    snapshot.trackedPlayerShots.push("backhand");

    expect(point.trackedPlayerShots).toEqual(["forehand"]);
  });
});

describe("isAce", () => {
  test("true when the tracked player serves an untouched ace", () => {
    const point = Point.create(pointData({ winner: TRACKED_ID, server: TRACKED_ID }));
    expect(point.isAce).toBe(true);
  });

  test("true when the opponent serves an untouched ace against the tracked player", () => {
    const point = Point.create(
      pointData({ outcome: "loss", winner: OPPONENT_ID, server: OPPONENT_ID }),
    );
    expect(point.isAce).toBe(true);
  });

  test("false once there are rally shots", () => {
    const point = Point.create(
      pointData({ winner: TRACKED_ID, server: TRACKED_ID, trackedPlayerShots: ["forehand"] }),
    );
    expect(point.isAce).toBe(false);
  });

  test("false when the point ended on an error, not an untouched serve", () => {
    const point = Point.create(
      pointData({
        winner: TRACKED_ID,
        server: TRACKED_ID,
        winBy: ["unforced_error", "forehand", null],
      }),
    );
    expect(point.isAce).toBe(false);
  });
});

describe("isDoubleFault", () => {
  test("true when the tracked player double-faults on the second serve", () => {
    const point = Point.create(
      pointData({
        serveNumber: "second",
        outcome: "loss",
        winner: OPPONENT_ID,
        server: TRACKED_ID,
      }),
    );
    expect(point.isDoubleFault).toBe(true);
  });

  test("true when the opponent double-faults on the second serve", () => {
    const point = Point.create(
      pointData({
        serveNumber: "second",
        outcome: "win",
        winner: TRACKED_ID,
        server: OPPONENT_ID,
      }),
    );
    expect(point.isDoubleFault).toBe(true);
  });

  test("false on the first serve", () => {
    const point = Point.create(
      pointData({
        serveNumber: "first",
        outcome: "loss",
        winner: OPPONENT_ID,
        server: TRACKED_ID,
      }),
    );
    expect(point.isDoubleFault).toBe(false);
  });

  test("isAce and isDoubleFault are mutually exclusive", () => {
    const ace = Point.create(pointData({ winner: TRACKED_ID, server: TRACKED_ID }));
    expect(ace.isAce && ace.isDoubleFault).toBe(false);

    const doubleFault = Point.create(
      pointData({
        serveNumber: "second",
        outcome: "loss",
        winner: OPPONENT_ID,
        server: TRACKED_ID,
      }),
    );
    expect(doubleFault.isAce && doubleFault.isDoubleFault).toBe(false);
  });
});

describe("rallyLength", () => {
  test("sums both shot arrays when opponentShots is recorded", () => {
    const point = Point.create(
      pointData({ trackedPlayerShots: ["forehand", "backhand"], opponentShots: ["slice"] }),
    );
    expect(point.rallyLength).toBe(3);
    expect(point.opponentDataComplete).toBe(true);
  });

  test("undercounts while opponentShots is null", () => {
    const point = Point.create(pointData({ trackedPlayerShots: ["forehand", "backhand"] }));
    expect(point.rallyLength).toBe(2);
    expect(point.opponentDataComplete).toBe(false);
  });
});

describe("exactRallyLength", () => {
  test("tracked player served and won cleanly: 2 * trackedCount", () => {
    const point = Point.create(
      pointData({
        server: TRACKED_ID,
        winner: TRACKED_ID,
        outcome: "win",
        winBy: null,
        trackedPlayerShots: ["forehand", "backhand"],
      }),
    );
    expect(point.exactRallyLength).toBe(4);
  });

  test("tracked player served and won by the opponent's error: 2 * trackedCount + 1", () => {
    const point = Point.create(
      pointData({
        server: TRACKED_ID,
        winner: TRACKED_ID,
        outcome: "win",
        winBy: ["unforced_error", "forehand", null],
        trackedPlayerShots: ["forehand", "backhand"],
      }),
    );
    expect(point.exactRallyLength).toBe(5);
  });

  test("opponent served and the tracked player lost by their own error: 2 * trackedCount - 1", () => {
    const point = Point.create(
      pointData({
        server: OPPONENT_ID,
        winner: OPPONENT_ID,
        outcome: "loss",
        lossBy: ["unforced_error", "backhand", "net"],
        trackedPlayerShots: ["forehand", "backhand"],
      }),
    );
    expect(point.exactRallyLength).toBe(3);
  });

  test("opponent served and won cleanly: 2 * trackedCount", () => {
    const point = Point.create(
      pointData({
        server: OPPONENT_ID,
        winner: OPPONENT_ID,
        outcome: "loss",
        lossBy: null,
        trackedPlayerShots: ["forehand", "backhand"],
      }),
    );
    expect(point.exactRallyLength).toBe(4);
  });

  test("zero when the tracked player has no recorded shots", () => {
    const point = Point.create(pointData({ trackedPlayerShots: [] }));
    expect(point.exactRallyLength).toBe(0);
  });
});

describe("approximateRallyLength", () => {
  test("returns the midpoint of the range, rounded", () => {
    const point = Point.create(pointData());
    expect(point.approximateRallyLength({ min: 4, max: 7 })).toBe(6);
    expect(point.approximateRallyLength({ min: 4, max: 6 })).toBe(5);
  });

  test.each([
    ["a negative min", { min: -1, max: 3 }],
    ["max below min", { min: 5, max: 3 }],
  ])("rejects %s", (_label, range) => {
    const point = Point.create(pointData());
    expect(() => point.approximateRallyLength(range)).toThrow();
  });
});
