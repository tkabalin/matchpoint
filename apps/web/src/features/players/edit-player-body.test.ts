import { zUpdatePlayerBody } from "@matchpoint/api-client/zod";
import { expect, test } from "vitest";

/**
 * Contract checks for the body `EditPlayerSheet` sends, per
 * `.claude/rules/web-tests.md`. `PlayerUpdate` is a true partial — unlike
 * `add-player-body.test.ts`'s full-record body, `buildPlayerUpdateBody` only ever
 * includes the fields that changed, so the checks here are about partial bodies
 * specifically: one field alone, and no fields at all.
 */

test("a body with a single changed field satisfies the generated contract", () => {
  expect(zUpdatePlayerBody.safeParse({ first_name: "Nomsa" }).success).toBe(true);
});

test("an empty body — nothing changed — is still valid", () => {
  expect(zUpdatePlayerBody.safeParse({}).success).toBe(true);
});

test("rejects a date of birth that isn't a calendar date", () => {
  expect(zUpdatePlayerBody.safeParse({ date_of_birth: "12/04/2008" }).success).toBe(false);
});

test("rejects a name over 100 characters and notes over 2000", () => {
  expect(zUpdatePlayerBody.safeParse({ first_name: "a".repeat(101) }).success).toBe(false);
  expect(zUpdatePlayerBody.safeParse({ notes: "a".repeat(2001) }).success).toBe(false);
});

test("rejects an unknown gender", () => {
  expect(zUpdatePlayerBody.safeParse({ gender: "unspecified" }).success).toBe(false);
});
