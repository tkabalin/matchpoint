import { zMatchCreate } from "@matchpoint/api-client/zod";
import { describe, expect, test } from "vitest";

import { createMatch, SCORING_SYSTEMS } from "@/features/capture/match";

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

  // Dropping the id would cost the server the only thing that lets it recognise a
  // replayed flush, so a retry would store the match a second time (#110).
  test("sends the id the match was minted with", () => {
    const played = match();
    expect(toMatchCreate(played).id).toBe(played.matchId);
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

  test("sends the event through unchanged", () => {
    const played = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      "traditional",
      "hard",
      null,
      "Regional Open",
    );
    expect(toMatchCreate(played).event).toBe("Regional Open");
  });

  test("maps no event to null", () => {
    expect(toMatchCreate(match()).event).toBeNull();
  });

  // Every member, not a sample: the pass-through holds only while the two enums agree
  // member for member, and zMatchCreate carries the API's list straight from the spec,
  // so a member the backend never added fails here instead of on sync.
  test.each(SCORING_SYSTEMS)("sends the %s scoring system through unchanged", (scoringSystem) => {
    const played = createMatch(
      PLAYED_ON,
      TRACKED_ID,
      ROSTERED_OPPONENT,
      TRACKED_ID,
      scoringSystem,
      "hard",
    );
    const body = toMatchCreate(played);

    expect(body.scoring_system).toBe(scoringSystem);
    expect(() => zMatchCreate.parse(body)).not.toThrow();
  });
});
