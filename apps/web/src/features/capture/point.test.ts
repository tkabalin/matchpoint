import { describe, expect, test } from "vitest";

import { NOTE_MAX_LENGTH, Point } from "./point";

// wing/shotType/ballIn/ballLocation must all be null on ACE/DOUBLE_FAULT/UNUSUAL points and
// on return-error points — spread this into pointData()'s overrides for any test building one.
const NO_CONTACT = { wing: null, shotType: null, ballIn: null, ballLocation: null };

/** Where a point sat in the match. Its own validation is tested below; what the nine
 * stamps mean is score.test.ts's subject. */
const CONTEXT = {
  setNumber: 1,
  gameNumber: 1,
  inTiebreak: false,
  isBreakPoint: false,
  isGamePoint: false,
  isGameEnd: false,
  isSetPoint: false,
  isSetEnd: false,
  isMatchPoint: false,
};

/** A minimal, valid raw Point payload — override just the fields a test cares about. */
function pointData(overrides: Record<string, unknown> = {}) {
  return {
    context: { ...CONTEXT },
    id: "point-1",
    matchId: "match-1",
    timestamp: 1_700_000_000_000,
    sequence: 0,
    server: "TRACKED",
    courtSide: "DEUCE",
    serves: [{ number: 1, outcome: "IN", location: null }],
    returnOutcome: null,
    won: true,
    endReason: "FORCED",
    unusualReason: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "DEEP" },
    rallyLengthBucket: null,
    ...overrides,
  };
}

/** The serves each no-contact ending needs to be coherent at all. */
function servesFor(endReason: "ACE" | "DOUBLE_FAULT" | "UNUSUAL") {
  if (endReason === "DOUBLE_FAULT") {
    return [
      { number: 1, outcome: "FAULT", location: "NET" },
      { number: 2, outcome: "FAULT", location: "LONG" },
    ];
  }
  if (endReason === "ACE") return [{ number: 1, outcome: "ACE", location: null }];
  return [{ number: 1, outcome: "IN", location: null }];
}

/** A minimal, valid ace payload — the serve itself is what makes it one. */
function aceData(overrides: Record<string, unknown> = {}) {
  return pointData({
    serves: [{ number: 1, outcome: "ACE", location: null }],
    endReason: "ACE",
    ...NO_CONTACT,
    ...overrides,
  });
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
    test.each([3, 4])("rejects a serves array of length %i", (length) => {
      const serves = Array.from({ length }, (_, index) => ({
        number: index + 1,
        outcome: "IN",
        location: null,
      }));
      expect(() => Point.create(pointData({ serves }))).toThrow(/serves/);
    });

    test("rejects a serve with the wrong number for its position", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 2, outcome: "IN", location: null }] })),
      ).toThrow(/number/);
    });

    test("rejects an unknown serve outcome", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "LET", location: null }] })),
      ).toThrow();
    });

    test("rejects a serve entry that isn't even an object", () => {
      expect(() => Point.create(pointData({ serves: ["not an object"] }))).toThrow(
        /is not a valid ServeAttempt/,
      );
    });

    test("rejects a serve entry whose number is outside 1 or 2", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 3, outcome: "IN", location: null }] })),
      ).toThrow(/is not a valid ServeAttempt/);
    });

    test("rejects a non-null location on an OPPONENT serve", () => {
      expect(() =>
        Point.create(
          pointData({
            server: "OPPONENT",
            serves: [{ number: 1, outcome: "FAULT", location: "NET" }],
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

    test("rejects a location on a TRACKED serve that went in — a landed serve has none", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "IN", location: "NET" }] })),
      ).toThrow(/must be null when outcome is IN/);
    });

    test("accepts a null location on a TRACKED serve that went in", () => {
      const point = Point.create(
        pointData({ serves: [{ number: 1, outcome: "IN", location: null }] }),
      );
      expect(point.serves[0]?.location).toBeNull();
    });

    test("accepts a point with no serve at all — the coach missed it", () => {
      const point = Point.create(pointData({ serves: [] }));
      expect(point.serves).toEqual([]);
      expect(point.firstServeIn).toBeNull();
    });

    test("accepts a lone faulted serve — the second one went unwatched", () => {
      const point = Point.create(
        pointData({ serves: [{ number: 1, outcome: "FAULT", location: "NET" }] }),
      );
      expect(point.serves).toHaveLength(1);
      expect(point.firstServeIn).toBe(false);
    });

    test("rejects a second attempt that doesn't follow a fault", () => {
      expect(() =>
        Point.create(
          pointData({
            serves: [
              { number: 1, outcome: "IN", location: null },
              { number: 2, outcome: "IN", location: null },
            ],
          }),
        ),
      ).toThrow(/requires the first serve to have faulted/);
    });

    test("rejects a non-FailureMode location on a TRACKED serve that faulted", () => {
      expect(() =>
        Point.create(pointData({ serves: [{ number: 1, outcome: "FAULT", location: null }] })),
      ).toThrow(/FailureMode/);
    });

    test("rejects a location on an ace — a landed serve carries none", () => {
      expect(() =>
        Point.create(
          pointData({
            serves: [{ number: 1, outcome: "ACE", location: "WIDE" }],
            endReason: "ACE",
            ...NO_CONTACT,
          }),
        ),
      ).toThrow(/must be null when outcome is ACE/);
    });

    test("an ace and its endReason require each other", () => {
      expect(() =>
        Point.create(
          pointData({
            serves: [{ number: 1, outcome: "ACE", location: null }],
            ...NO_CONTACT,
          }),
        ),
      ).toThrow(/must have endReason ACE/);
      expect(() => Point.create(pointData({ endReason: "ACE", ...NO_CONTACT }))).toThrow(
        /requires a serve recorded as an ace/,
      );
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
              { number: 1, outcome: "IN", location: null },
              { number: 2, outcome: "IN", location: null },
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

    test("rejects a returnOutcome with no observed serve to attach it to", () => {
      expect(() => Point.create(returnErrorData({ serves: [], returnOutcome: "NET" }))).toThrow(
        /returnOutcome requires an observed serve/,
      );
    });
  });

  test("rejects a non-boolean won", () => {
    expect(() => Point.create(pointData({ won: "yes" }))).toThrow(/won/);
  });

  test("rejects an unknown endReason", () => {
    expect(() => Point.create(pointData({ endReason: "WINNER" }))).toThrow(/endReason/);
  });

  describe("unusualReason", () => {
    test("rejects a non-null unusualReason when endReason isn't UNUSUAL", () => {
      expect(() => Point.create(pointData({ unusualReason: "HINDRANCE" }))).toThrow(
        /unusualReason/,
      );
    });

    test("accepts an UNUSUAL point with no reason — the escape hatch stays optional", () => {
      const point = Point.create(
        pointData({
          endReason: "UNUSUAL",
          unusualReason: null,
          ...NO_CONTACT,
        }),
      );
      expect(point.unusualReason).toBeNull();
    });

    test("accepts an UNUSUAL point with a reason", () => {
      const point = Point.create(
        pointData({
          endReason: "UNUSUAL",
          unusualReason: "POINT_PENALTY",
          ...NO_CONTACT,
        }),
      );
      expect(point.unusualReason).toBe("POINT_PENALTY");
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

  describe("note", () => {
    test("defaults to null", () => {
      expect(Point.create(pointData()).note).toBeNull();
    });

    test("accepts a coach note on an ordinary (non-UNUSUAL) point", () => {
      const point = Point.create(pointData({ note: "favoring the backhand today" }));
      expect(point.note).toBe("favoring the backhand today");
    });

    test("rejects an empty string — null is how 'no note' is spelled", () => {
      expect(() => Point.create(pointData({ note: "" }))).toThrow(/note/);
    });

    test("truncates a note past what the API accepts rather than losing the point", () => {
      const point = Point.create(pointData({ note: "a".repeat(NOTE_MAX_LENGTH + 500) }));
      expect(point.note).toBe("a".repeat(NOTE_MAX_LENGTH));
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
              serves: servesFor(endReason),
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

    test("rejects an unknown wing", () => {
      expect(() => Point.create(pointData({ wing: "SIDEARM", shotType: "DRIVE" }))).toThrow(
        /invalid wing/,
      );
    });

    test("rejects an unknown shotType", () => {
      expect(() => Point.create(pointData({ wing: "FOREHAND", shotType: "SMASH" }))).toThrow(
        /invalid shotType/,
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

    test("accepts a null ballIn on a FORCED/MISTAKE point — the coach missed where it landed", () => {
      const point = Point.create(pointData({ ballIn: null, ballLocation: null }));
      expect(point.ballIn).toBeNull();
      expect(point.ballLocation).toBeNull();
    });

    test("rejects a ballLocation with no ballIn beside it", () => {
      expect(() =>
        Point.create(pointData({ ballIn: null, ballLocation: { half: "AD", depth: "SHORT" } })),
      ).toThrow(/ballLocation must be null/);
    });

    test("rejects a ballIn that isn't a boolean or null", () => {
      expect(() => Point.create(pointData({ ballIn: "yes" }))).toThrow(
        /ballIn must be a boolean or null/,
      );
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
              serves: servesFor(endReason),
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
        aceData({
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
    const serves: { number: number; outcome: string; location: string | null }[] = [
      { number: 1, outcome: "FAULT", location: "NET" },
    ];
    const point = Point.create(pointData({ serves }));

    serves.push({ number: 2, outcome: "IN", location: null });

    expect(point.serves).toHaveLength(1);
  });

  test("mutating toJSON()'s output does not affect the Point", () => {
    const point = Point.create(pointData());

    const snapshot = point.toJSON();
    snapshot.serves.push({ number: 2, outcome: "IN", location: null });

    expect(point.serves).toHaveLength(1);
  });

  test("mutating toJSON()'s ballLocation object does not affect the Point", () => {
    const point = Point.create(pointData({ ballLocation: { half: "DEUCE", depth: "DEEP" } }));

    const snapshot = point.toJSON();
    if (snapshot.ballLocation !== null && typeof snapshot.ballLocation !== "string") {
      snapshot.ballLocation.depth = "DEEP";
    }

    expect(point.ballLocation).toEqual({ half: "DEUCE", depth: "DEEP" });
  });
});

describe("isAce", () => {
  test("true when endReason is ACE", () => {
    const point = Point.create(aceData());
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
    const ace = Point.create(aceData());
    expect(ace.isAce && ace.isDoubleFault).toBe(false);

    const doubleFault = Point.create(doubleFaultData());
    expect(doubleFault.isAce && doubleFault.isDoubleFault).toBe(false);
  });
});

describe("context", () => {
  test("is required — a point always knows where in the match it sat", () => {
    const { context, ...withoutContext } = pointData();
    void context;
    expect(() => Point.create(withoutContext)).toThrow(/context must be an object/);
  });

  test.each(["setNumber", "gameNumber"])("rejects a non-positive %s", (field) => {
    expect(() => Point.create(pointData({ context: { ...CONTEXT, [field]: 0 } }))).toThrow(
      new RegExp(field),
    );
  });

  test.each([
    "inTiebreak",
    "isBreakPoint",
    "isGamePoint",
    "isGameEnd",
    "isSetPoint",
    "isSetEnd",
    "isMatchPoint",
  ])("rejects a non-boolean %s", (flag) => {
    expect(() => Point.create(pointData({ context: { ...CONTEXT, [flag]: "yes" } }))).toThrow(
      new RegExp(flag),
    );
  });

  test("is copied out by toJSON rather than shared", () => {
    const point = Point.create(pointData());
    const json = point.toJSON();
    json.context.setNumber = 9;
    expect(point.context.setNumber).toBe(1);
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
          { number: 2, outcome: "IN", location: null },
        ],
      }),
    );
    expect(point.firstServeIn).toBe(false);
  });

  test("null when the serve was never recorded — not the same as it having missed", () => {
    const point = Point.create(pointData({ serves: [] }));
    expect(point.firstServeIn).toBeNull();
  });

  test("false when the first serve faulted and the second went unwatched", () => {
    const point = Point.create(
      pointData({ serves: [{ number: 1, outcome: "FAULT", location: "NET" }] }),
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
