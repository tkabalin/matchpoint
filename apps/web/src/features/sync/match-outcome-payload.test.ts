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
      result_reason: "walkover",
    });
  });

  test("maps the tracked player losing to a loss result", () => {
    expect(toMatchOutcomeUpdate({ reason: "default", trackedPlayerWon: false })).toEqual({
      result: "loss",
      result_reason: "default",
    });
  });

  // The four capture reasons are the API enum member for member, "completed" included:
  // a match played out to its end says so rather than leaving the column null.
  test.each(["retirement", "walkover", "default", "completed"])(
    "sends %s as the result reason",
    (reason) => {
      const body = toMatchOutcomeUpdate({ reason, trackedPlayerWon: true });
      expect(body.result_reason).toBe(reason);
      expect(() => zMatchUpdate.parse(body)).not.toThrow();
    },
  );

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
