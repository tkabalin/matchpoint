import { afterEach, expect, test, vi } from "vitest";

import { MAX_AGE_YEARS, dateOfBirthError, earliestDateOfBirthIso, todayIso } from "./date-of-birth";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("accepts an ordinary date of birth", () => {
  expect(dateOfBirthError("2008-04-12")).toBeNull();
});

test("requires a value", () => {
  expect(dateOfBirthError("")).toBe("Date of birth is required.");
});

test("rejects a future date", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-18T09:00:00Z"));

  expect(dateOfBirthError("2026-08-19")).toBe("Date of birth cannot be in the future.");
});

// The server takes the same view, and says so: today is not the future, and a
// validator that rejects a value the rule permits costs an afternoon to track down.
test("accepts today", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-18T09:00:00Z"));

  expect(dateOfBirthError(todayIso())).toBeNull();
});

test(`rejects more than ${MAX_AGE_YEARS} years ago`, () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-18T09:00:00Z"));

  expect(dateOfBirthError("1900-01-01")).toBe(
    `Date of birth cannot be more than ${MAX_AGE_YEARS} years ago.`,
  );
  expect(dateOfBirthError(earliestDateOfBirthIso())).toBeNull();
});

// Compared as ISO strings rather than Date objects, so a timezone east of UTC can't
// shift the boundary a day — the trap .claude/rules/web.md documents for the API's
// own date fields.
test("holds the boundary in a timezone ahead of UTC", () => {
  vi.stubEnv("TZ", "Africa/Johannesburg");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-17T23:30:00Z"));

  // 01:30 local on the 18th; today is the 18th, so the 18th is not the future.
  expect(dateOfBirthError("2026-08-18")).toBeNull();
  expect(dateOfBirthError("2026-08-19")).toBe("Date of birth cannot be in the future.");
});
