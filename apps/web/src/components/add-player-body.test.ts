import { zCreatePlayerBody } from "@matchpoint/api-client/zod";
import { expect, test } from "vitest";

/**
 * Contract checks for the body `AddPlayerSheet` sends.
 *
 * The generated client types this body, so a renamed field is already a tsc error.
 * What the compiler cannot see is the constraints the spec carries beyond the
 * primitive type — `format: date`, and the length bounds — which all erase to
 * `string`. Parsing against the generated Zod schema is what catches those, per
 * `.claude/rules/web-tests.md`.
 */

const validBody = {
  first_name: "Nomsa",
  last_name: "Khumalo",
  date_of_birth: "2008-04-12",
  gender: "female",
  dominant_hand: "right",
  notes: null,
} as const;

test("the body the form builds satisfies the generated contract", () => {
  expect(zCreatePlayerBody.safeParse(validBody).success).toBe(true);
});

// The reason the form holds a raw YYYY-MM-DD string rather than a Date: anything
// else fails format: date, and the compiler would not have said so.
test("rejects a date of birth that isn't a calendar date", () => {
  expect(zCreatePlayerBody.safeParse({ ...validBody, date_of_birth: "12/04/2008" }).success).toBe(
    false,
  );
  expect(
    zCreatePlayerBody.safeParse({ ...validBody, date_of_birth: new Date().toISOString() }).success,
  ).toBe(false);
});

// The maxLength values the form mirrors by hand, asserted against the spec so a
// change on the API side fails here rather than at runtime.
test("rejects names over 100 characters and notes over 2000", () => {
  expect(zCreatePlayerBody.safeParse({ ...validBody, first_name: "a".repeat(101) }).success).toBe(
    false,
  );
  expect(zCreatePlayerBody.safeParse({ ...validBody, first_name: "a".repeat(100) }).success).toBe(
    true,
  );
  expect(zCreatePlayerBody.safeParse({ ...validBody, notes: "a".repeat(2001) }).success).toBe(
    false,
  );
});

test("rejects an unknown gender", () => {
  expect(zCreatePlayerBody.safeParse({ ...validBody, gender: "unspecified" }).success).toBe(false);
});
