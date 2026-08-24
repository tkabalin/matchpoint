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
    serves: [{ number: 1, outcome: "IN", location: "T" }],
    returnOutcome: null,
    won: true,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "DEEP" },
    rallyLengthBucket: null,
  });
}

describe("toPointCreate", () => {
  // #210 hasn't landed, so this is the one place the throw is exercised: drain.test.ts
  // mocks the whole module to test the engine, not this function's own body.
  test("throws until the capture model carries the score-context stamps", () => {
    expect(() => toPointCreate(point())).toThrow(/cannot be mapped/);
  });
});
