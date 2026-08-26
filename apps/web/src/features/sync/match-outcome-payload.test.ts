import { zMatchUpdate } from "@matchpoint/api-client/zod";
import { describe, expect, test } from "vitest";

import { toMatchOutcomeUpdate } from "./match-outcome-payload";

describe("toMatchOutcomeUpdate", () => {
  // The check the generated TypeScript types cannot make on their own — see
  // match-payload.test.ts's identical comment.
  test("produces a body the API's own contract accepts", () => {
    expect(() =>
      zMatchUpdate.parse(toMatchOutcomeUpdate({ reason: "retirement", trackedPlayerWon: true })),
    ).not.toThrow();
  });

  test("maps the tracked player winning to a win result", () => {
    expect(toMatchOutcomeUpdate({ reason: "walkover", trackedPlayerWon: true })).toEqual({
      result: "win",
    });
  });

  test("maps the tracked player losing to a loss result", () => {
    expect(toMatchOutcomeUpdate({ reason: "default", trackedPlayerWon: false })).toEqual({
      result: "loss",
    });
  });

  // The reason is carried for a future field (docs/database-changes-needed.md) but
  // MatchResult has no home for it yet, so today's mapping drops it.
  test("does not send the reason — the API has nowhere to put it yet", () => {
    const body = toMatchOutcomeUpdate({ reason: "retirement", trackedPlayerWon: true });
    expect(body).not.toHaveProperty("reason");
  });

  test.each([
    ["not an object", "nonsense"],
    ["null", null],
    ["missing trackedPlayerWon", { reason: "retirement" }],
    ["an invalid reason", { reason: "injury", trackedPlayerWon: true }],
    ["a non-boolean trackedPlayerWon", { reason: "retirement", trackedPlayerWon: "yes" }],
  ])("rejects a payload that is %s", (_label, payload) => {
    expect(() => toMatchOutcomeUpdate(payload)).toThrow();
  });
});
