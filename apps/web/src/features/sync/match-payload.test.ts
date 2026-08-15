import { zMatchCreate } from "@matchpoint/api-client/zod";
import { describe, expect, test } from "vitest";

import { createMatch } from "@/features/capture/match";

import { toMatchCreate } from "./match-payload";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const PLAYED_ON = "2026-08-15";
const ROSTERED_OPPONENT = { opponentId: OPPONENT_ID };

function match() {
  return createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID, "traditional", "hard");
}

describe("toMatchCreate", () => {
  // The check the generated TypeScript types cannot make: they erase `format: date`,
  // `format: uuid` and ShortText's length bounds to `string`, so only the schema
  // generated from the same spec knows the difference.
  test("produces a body the API's own contract accepts", () => {
    expect(() => zMatchCreate.parse(toMatchCreate(match()))).not.toThrow();
  });

  test("maps the tracked player, not the opponent, to player_id", () => {
    expect(toMatchCreate(match()).player_id).toBe(TRACKED_ID);
  });

  test("passes played_on through unchanged — Match already stores it date-only", () => {
    expect(toMatchCreate(match()).played_on).toBe(PLAYED_ON);
  });

  test("sends a concrete surface through unchanged", () => {
    expect(toMatchCreate(match()).surface).toBe("hard");
  });

  // "unspecified" is a real SurfaceType member with no backend equivalent — the
  // API's `surface` is nullable instead (see match-payload.ts).
  test("maps an unspecified surface to null", () => {
    const played = createMatch(PLAYED_ON, TRACKED_ID, ROSTERED_OPPONENT, TRACKED_ID);
    expect(toMatchCreate(played).surface).toBeNull();
  });

  test("maps a free-text opponent name through unchanged", () => {
    const played = createMatch(PLAYED_ON, TRACKED_ID, { opponentName: "Jane Rival" }, TRACKED_ID);
    expect(toMatchCreate(played).opponent_name).toBe("Jane Rival");
  });

  test("maps a rostered opponent, which has no name, to null", () => {
    expect(toMatchCreate(match()).opponent_name).toBeNull();
  });

  test.each([
    ["pro_set", "best_of_1"],
    ["traditional", "best_of_3"],
    ["mens_grand_slam", "best_of_5"],
  ] as const)("maps %s to %s", (scoringSystem, expected) => {
    const played = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      scoringSystem,
      "hard",
    );
    expect(toMatchCreate(played).sets_format).toBe(expected);
  });
});
