import { expect, test } from "vitest";

import { relativeTimeFrom } from "./relative-time";

const NOW = new Date("2026-08-23T12:00:00Z").getTime();

test("under a minute reads as just now", () => {
  expect(relativeTimeFrom(NOW - 30_000, NOW)).toBe("just now");
});

test("minutes ago", () => {
  expect(relativeTimeFrom(NOW - 5 * 60_000, NOW)).toBe("5m ago");
});

test("just under an hour still reads in minutes", () => {
  expect(relativeTimeFrom(NOW - 59 * 60_000, NOW)).toBe("59m ago");
});

test("hours ago", () => {
  expect(relativeTimeFrom(NOW - 2 * 60 * 60_000, NOW)).toBe("2h ago");
});

test("just under a day still reads in hours", () => {
  expect(relativeTimeFrom(NOW - 23 * 60 * 60_000, NOW)).toBe("23h ago");
});

test("days ago", () => {
  expect(relativeTimeFrom(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3d ago");
});

test("a future timestamp doesn't go negative", () => {
  expect(relativeTimeFrom(NOW + 60_000, NOW)).toBe("just now");
});
