import { describe, expect, test } from "vitest";

import { Point } from "@/features/capture/point";

import { toPointCreate } from "./point-payload";

function point() {
  return Point.create({
    id: "point-1",
    matchId: "match-1",
    timestamp: 1_700_000_000_000,
    sequence: 0,
    server: "TRACKED",
    courtSide: "DEUCE",
    won: true,
    context: {
      setNumber: 1,
      gameNumber: 1,
      inTiebreak: false,
      isBreakPoint: false,
      isGamePoint: false,
      isGameEnd: false,
      isSetPoint: false,
      isSetEnd: false,
      isMatchPoint: false,
    },
    serves: [{ number: 1, outcome: "IN", location: null }],
    returnOutcome: null,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "DEEP" },
    rallyLengthBucket: null,
  });
}

describe("toPointCreate", () => {
  // The API can't store an unwatched serve or ending yet, so this is the one place the
  // throw is exercised: drain.test.ts mocks the whole module to test the engine, not
  // this function's own body.
  test("throws until the API can store a point with an observation hole", () => {
    expect(() => toPointCreate(point())).toThrow(/cannot be mapped/);
  });
});
