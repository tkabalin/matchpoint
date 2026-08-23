import { describe, expect, test } from "vitest";

import { Point } from "./point";

// wing/shotType/ballIn/ballLocation must all be null on ACE/DOUBLE_FAULT/UNUSUAL points and
// on return-error points — spread this into pointData()'s overrides for any test building one.
const NO_CONTACT = { wing: null, shotType: null, ballIn: null, ballLocation: null };

/** A minimal, valid raw Point payload — override just the fields a test cares about. */
function pointData(overrides: Record<string, unknown> = {}) {
  return {
    id: "point-1",
    matchId: "match-1",
    timestamp: 1_700_000_000_000,
    sequence: 0,
    server: "TRACKED",
    courtSide: "DEUCE",
    serves: [{ number: 1, outcome: "IN", location: "T" }],
    returnOutcome: null,
    won: true,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "MID" },
    rallyLengthBucket: null,
    ...overrides,
  };
}

/** A minimal, valid double-fault point payload — both serves faulted, no contact fields. */
function doubleFaultData(overrides: Record<string, unknown> = {}) {
  return pointData({
    serves: [
      { number: 1, outcome: "FAULT", location: "NET" },
      { number: 2, outcome: "FAULT", location: "LONG" },
    ],
    endReason: "DOUBLE_FAULT",
    won: false,
    ...NO_CONTACT,
    ...overrides,
  });
}

/** A minimal, valid return-error point payload — opponent served, our return missed. */
function returnErrorData(overrides: Record<string, unknown> = {}) {
  return pointData({
    server: "OPPONENT",
    serves: [{ number: 1, outcome: "IN", location: null }],
    returnOutcome: "NET",
    endReason: "MISTAKE",
    won: false,
    ...NO_CONTACT,
    ...overrides,
  });
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

  test.each(["id", "matchId"])("rejects an empty %s", (field) => {
    expect(() => Point.create(pointData({ [field]: "" }))).toThrow();
  });

  test("rejects a non-finite timestamp", () => {
    expect(() => Point.create(pointData({ timestamp: Number.NaN }))).toThrow(/timestamp/);
  });

  test.each([-1, 1.5])("rejects a sequence of %s", (sequence) => {
    expect(() => Point.create(pointData({ sequence }))).toThrow(/sequence/);
  });

  test("rejects an unknown server", () => {
    expect(() => Point.create(pointData({ server: "REFEREE" }))).toThrow(/server/);
  });

  describe("courtSide", () => {
    test.each(["DEUCE", "AD"] as const)("accepts %s", (courtSide) => {
      const point = Point.create(pointData({ courtSide }));
      expect(point.courtSide).toBe(courtSide);
    });

    test("rejects an unknown courtSide", () => {
      expect(() => Point.create(pointData({ courtSide: "LEFT" }))).toThrow(/courtSide/);
    });

    test("rejects a null courtSide — unlike deuceOrAd, every point has one", () => {
      expect(() => Point.create(pointData({ courtSide: null }))).toThrow(/courtSide/);
    });
  });

  describe("serves", () => {
    test.each([0, 3])("rejects a serves array of length %i", (length) => {
      const serves = Array.from({ length }, (_, index) => ({
        number: index + 1,
        outcome: "IN",
        location: "T",
      }));
      expect(() => Point.create(pointData({ serves }))).toThrow(/serves/);
    });

    test("rejects a serve with the wrong number for its position", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 2, outcome: "IN", location: "T" }] })),
      ).toThrow(/number/);
    });

    test("rejects an unknown serve outcome", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "LET", location: "T" }] })),
      ).toThrow();
    });

    test("rejects a non-null location on an OPPONENT serve", () => {
      expect(() =>
        Point.create(
          pointData({
            server: "OPPONENT",
            serves: [{ number: 1, outcome: "IN", location: "T" }],
          }),
        ),
      ).toThrow(/OPPONENT/);
    });

    test("accepts a null location on an OPPONENT serve", () => {
      const point = Point.create(
        pointData({
          server: "OPPONENT",
          serves: [{ number: 1, outcome: "IN", location: null }],
          returnOutcome: "IN",
          won: false,
        }),
      );
      expect(point.serves[0]?.location).toBeNull();
    });

    test("rejects a FailureMode location on a TRACKED serve that went in", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "IN", location: "NET" }] })),
      ).toThrow(/ServeTarget/);
    });

    test("accepts a null location on a TRACKED serve that went in — placement is optional", () => {
      const point = Point.create(
        pointData({ serves: [{ number: 1, outcome: "IN", location: null }] }),
      );
      expect(point.serves[0]?.location).toBeNull();
    });

    test("rejects a non-FailureMode location on a TRACKED serve that faulted", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "FAULT", location: "T" }] })),
      ).toThrow(/FailureMode/);
    });

    test("accepts a ServeTarget location on an ace", () => {
      const point = Point.create(
        pointData({
          serves: [{ number: 1, outcome: "ACE", location: "WIDE" }],
          endReason: "ACE",
          ...NO_CONTACT,
        }),
      );
      expect(point.serves[0]?.location).toBe("WIDE");
    });

    test("rejects a lone faulted first serve with no second attempt", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "FAULT", location: "NET" }] })),
      ).toThrow(/second serve/);
    });

    test("rejects a double fault whose endReason isn't DOUBLE_FAULT", () => {
      expect(() =>
        Point.create(
          pointData({
            serves: [
              { number: 1, outcome: "FAULT", location: "NET" },
              { number: 2, outcome: "FAULT", location: "LONG" },
            ],
            endReason: "MISTAKE",
            won: false,
          }),
        ),
      ).toThrow(/DOUBLE_FAULT/);
    });

    test("accepts a double fault with endReason DOUBLE_FAULT", () => {
      const point = Point.create(doubleFaultData());
      expect(point.isDoubleFault).toBe(true);
    });

    test("rejects a second serve attempt when the first serve didn't fault", () => {
      expect(() =>
        Point.create(
          pointData({
            serves: [
              { number: 1, outcome: "IN", location: "T" },
              { number: 2, outcome: "IN", location: "T" },
            ],
          }),
        ),
      ).toThrow(/first serve to have faulted/);
    });

    test("rejects endReason DOUBLE_FAULT when the serves weren't both faulted", () => {
      expect(() => Point.create(doubleFaultData({ serves: [pointData().serves[0]] }))).toThrow(
        /DOUBLE_FAULT requires both serves/,
      );
    });
  });

  describe("returnOutcome", () => {
    test("rejects a non-null returnOutcome when server is TRACKED", () => {
      expect(() => Point.create(pointData({ returnOutcome: "IN" }))).toThrow(/TRACKED/);
    });

    test("accepts a null returnOutcome when server is OPPONENT", () => {
      const point = Point.create(
        pointData({
          server: "OPPONENT",
          serves: [{ number: 1, outcome: "IN", location: null }],
          returnOutcome: null,
        }),
      );
      expect(point.returnOutcome).toBeNull();
    });

    test("rejects an unknown returnOutcome", () => {
      expect(() =>
        Point.create(
          pointData({
            server: "OPPONENT",
            serves: [{ number: 1, outcome: "IN", location: null }],
            returnOutcome: "OUT",
          }),
        ),
      ).toThrow(/returnOutcome/);
    });

    test.each(["NET", "LONG", "WIDE"] as const)(
      "accepts a %s returnOutcome — the point ends on the return, no contact fields",
      (outcome) => {
        const point = Point.create(returnErrorData({ returnOutcome: outcome }));
        expect(point.returnOutcome).toBe(outcome);
        expect(point.wing).toBeNull();
        expect(point.ballLocation).toBeNull();
      },
    );
  });

  test("rejects a non-boolean won", () => {
    expect(() => Point.create(pointData({ won: "yes" }))).toThrow(/won/);
  });

  test("rejects an unknown endReason", () => {
    expect(() => Point.create(pointData({ endReason: "WINNER" }))).toThrow(/endReason/);
  });

  describe("unusualReason / unusualNote", () => {
    test("rejects a non-null unusualReason when endReason isn't UNUSUAL", () => {
      expect(() => Point.create(pointData({ unusualReason: "HINDRANCE" }))).toThrow(
        /unusualReason/,
      );
    });

    test("rejects a non-null unusualNote when endReason isn't UNUSUAL", () => {
      expect(() => Point.create(pointData({ unusualNote: "let it go" }))).toThrow(/unusualNote/);
    });

    test("accepts an UNUSUAL point with no reason or note — the escape hatch stays optional", () => {
      const point = Point.create(
        pointData({
          endReason: "UNUSUAL",
          unusualReason: null,
          unusualNote: null,
          ...NO_CONTACT,
        }),
      );
      expect(point.unusualReason).toBeNull();
      expect(point.unusualNote).toBeNull();
    });

    test("accepts an UNUSUAL point with a reason and note", () => {
      const point = Point.create(
        pointData({
          endReason: "UNUSUAL",
          unusualReason: "POINT_PENALTY",
          unusualNote: "coach warning",
          ...NO_CONTACT,
        }),
      );
      expect(point.unusualReason).toBe("POINT_PENALTY");
      expect(point.unusualNote).toBe("coach warning");
    });

    test("rejects an unknown unusualReason", () => {
      expect(() =>
        Point.create(
          pointData({
            endReason: "UNUSUAL",
            unusualReason: "SLIPPED",
            ...NO_CONTACT,
          }),
        ),
      ).toThrow(/unusualReason/);
    });
  });

  describe("wing / shotType", () => {
    test("accepts both set together", () => {
      const point = Point.create(pointData({ wing: "FOREHAND", shotType: "DRIVE" }));
      expect(point.wing).toBe("FOREHAND");
      expect(point.shotType).toBe("DRIVE");
    });

    test.each(["wing", "shotType"])("rejects %s set without the other", (field) => {
      const value = field === "wing" ? "FOREHAND" : "DRIVE";
      expect(() => Point.create(pointData({ [field]: value }))).toThrow(/set together/);
    });

    test.each(["ACE", "DOUBLE_FAULT", "UNUSUAL"] as const)(
      "rejects a non-null wing/shotType on a %s point",
      (endReason) => {
        expect(() =>
          Point.create(
            pointData({
              endReason,
              wing: "FOREHAND",
              shotType: "DRIVE",
              serves:
                endReason === "DOUBLE_FAULT"
                  ? [
                      { number: 1, outcome: "FAULT", location: "NET" },
                      { number: 2, outcome: "FAULT", location: "LONG" },
                    ]
                  : pointData().serves,
            }),
          ),
        ).toThrow(/wing and shotType must be null/);
      },
    );

    test("rejects a non-null wing/shotType on a return-error point", () => {
      expect(() => Point.create(returnErrorData({ wing: "FOREHAND", shotType: "DRIVE" }))).toThrow(
        /wing and shotType must be null/,
      );
    });
  });

  describe("ballIn / ballLocation", () => {
    test("accepts a CourtZone location when ballIn is true", () => {
      const point = Point.create(
        pointData({ ballIn: true, ballLocation: { half: "AD", depth: "DEEP" } }),
      );
      expect(point.ballLocation).toEqual({ half: "AD", depth: "DEEP" });
    });

    test("accepts a FailureMode location when ballIn is false", () => {
      const point = Point.create(
        pointData({ won: false, endReason: "MISTAKE", ballIn: false, ballLocation: "LONG" }),
      );
      expect(point.ballLocation).toBe("LONG");
    });

    test("rejects a FailureMode location when ballIn is true", () => {
      expect(() => Point.create(pointData({ ballIn: true, ballLocation: "LONG" }))).toThrow(
        /CourtZone/,
      );
    });

    test("rejects a CourtZone location when ballIn is false", () => {
      expect(() =>
        Point.create(
          pointData({
            won: false,
            endReason: "MISTAKE",
            ballIn: false,
            ballLocation: { half: "AD", depth: "DEEP" },
          }),
        ),
      ).toThrow(/FailureMode/);
    });

    test("rejects a null ballIn on a FORCED/MISTAKE point", () => {
      expect(() => Point.create(pointData({ ballIn: null, ballLocation: null }))).toThrow(/ballIn/);
    });

    test.each(["ACE", "DOUBLE_FAULT", "UNUSUAL"] as const)(
      "rejects a non-null ballIn/ballLocation on a %s point",
      (endReason) => {
        expect(() =>
          Point.create(
            pointData({
              endReason,
              wing: null,
              shotType: null,
              serves:
                endReason === "DOUBLE_FAULT"
                  ? [
                      { number: 1, outcome: "FAULT", location: "NET" },
                      { number: 2, outcome: "FAULT", location: "LONG" },
                    ]
                  : pointData().serves,
            }),
          ),
        ).toThrow(/ballIn and ballLocation must be null/);
      },
    );

    test("rejects a non-null ballIn/ballLocation on a return-error point", () => {
      expect(() => Point.create(returnErrorData({ ballIn: false, ballLocation: "NET" }))).toThrow(
        /ballIn and ballLocation must be null/,
      );
    });
  });

  describe("rallyLengthBucket", () => {
    test("accepts a valid bucket", () => {
      const point = Point.create(pointData({ rallyLengthBucket: "B3" }));
      expect(point.rallyLengthBucket).toBe("B3");
    });

    test("accepts null — never silently defaulted", () => {
      const point = Point.create(pointData({ rallyLengthBucket: null }));
      expect(point.rallyLengthBucket).toBeNull();
    });

    test("does not override a provided bucket even for an ACE", () => {
      const point = Point.create(
        pointData({
          endReason: "ACE",
          wing: null,
          shotType: null,
          ballIn: null,
          ballLocation: null,
          rallyLengthBucket: "B1",
        }),
      );
      expect(point.rallyLengthBucket).toBe("B1");
    });

    test("rejects an unknown bucket", () => {
      expect(() => Point.create(pointData({ rallyLengthBucket: "B5" }))).toThrow(
        /rallyLengthBucket/,
      );
    });
  });
});

describe("Point.fromJSON / toJSON", () => {
  test("round-trips through JSON", () => {
    const original = Point.create(pointData({ wing: "BACKHAND", shotType: "VOLLEY" }));

    const rehydrated = Point.fromJSON(JSON.parse(JSON.stringify(original.toJSON())));

    expect(rehydrated.toJSON()).toEqual(original.toJSON());
  });
});

describe("immutability", () => {
  test("mutating the input serves array after create() does not affect the Point", () => {
    const serves = [{ number: 1, outcome: "IN", location: "T" }];
    const point = Point.create(pointData({ serves }));

    serves.push({ number: 2, outcome: "IN", location: "T" });

    expect(point.serves).toHaveLength(1);
  });

  test("mutating toJSON()'s output does not affect the Point", () => {
    const point = Point.create(pointData());

    const snapshot = point.toJSON();
    snapshot.serves.push({ number: 2, outcome: "IN", location: "T" });

    expect(point.serves).toHaveLength(1);
  });

  test("mutating toJSON()'s ballLocation object does not affect the Point", () => {
    const point = Point.create(pointData({ ballLocation: { half: "DEUCE", depth: "MID" } }));

    const snapshot = point.toJSON();
    if (snapshot.ballLocation !== null && typeof snapshot.ballLocation !== "string") {
      snapshot.ballLocation.depth = "DEEP";
    }

    expect(point.ballLocation).toEqual({ half: "DEUCE", depth: "MID" });
  });
});

describe("isAce", () => {
  test("true when endReason is ACE", () => {
    const point = Point.create(pointData({ endReason: "ACE", ...NO_CONTACT }));
    expect(point.isAce).toBe(true);
  });

  test("false otherwise", () => {
    const point = Point.create(pointData({ endReason: "FORCED" }));
    expect(point.isAce).toBe(false);
  });
});

describe("isDoubleFault", () => {
  test("true when both serves faulted", () => {
    const point = Point.create(doubleFaultData());
    expect(point.isDoubleFault).toBe(true);
  });

  test("false on a single serve", () => {
    const point = Point.create(pointData());
    expect(point.isDoubleFault).toBe(false);
  });

  test("isAce and isDoubleFault are mutually exclusive", () => {
    const ace = Point.create(pointData({ endReason: "ACE", ...NO_CONTACT }));
    expect(ace.isAce && ace.isDoubleFault).toBe(false);

    const doubleFault = Point.create(doubleFaultData());
    expect(doubleFault.isAce && doubleFault.isDoubleFault).toBe(false);
  });
});

describe("firstServeIn", () => {
  test("true with a single serve", () => {
    const point = Point.create(pointData());
    expect(point.firstServeIn).toBe(true);
  });

  test("false once a second serve was needed", () => {
    const point = Point.create(
      pointData({
        serves: [
          { number: 1, outcome: "FAULT", location: "NET" },
          { number: 2, outcome: "IN", location: "T" },
        ],
      }),
    );
    expect(point.firstServeIn).toBe(false);
  });
});

describe("lastShotPlayer", () => {
  test("TRACKED when the tracked player won", () => {
    const point = Point.create(pointData({ won: true }));
    expect(point.lastShotPlayer).toBe("TRACKED");
  });

  test("OPPONENT when the tracked player lost", () => {
    const point = Point.create(pointData({ won: false, endReason: "MISTAKE" }));
    expect(point.lastShotPlayer).toBe("OPPONENT");
  });
});
