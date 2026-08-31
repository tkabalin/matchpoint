import { getCurrentCoach } from "@matchpoint/api-client";
import { afterEach, expect, test, vi } from "vitest";

import { getErrorStatus, shouldRetryQuery } from "./error-status";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("reads a status attached to the error object", () => {
  expect(getErrorStatus({ detail: "Not signed in", status: 401 })).toBe(401);
});

test("returns undefined when there is no status, or nothing recognisable at all", () => {
  expect(getErrorStatus({ detail: "Not signed in" })).toBeUndefined();
  expect(getErrorStatus({ status: "401" })).toBeUndefined();
  expect(getErrorStatus(null)).toBeUndefined();
  expect(getErrorStatus(undefined)).toBeUndefined();
  expect(getErrorStatus(new TypeError("Failed to fetch"))).toBeUndefined();
});

test("a thrown 401 carries its status, via error-interceptor.ts's error interceptor", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "Not signed in" }), { status: 401 }),
      ),
  );

  await expect(getCurrentCoach({ throwOnError: true })).rejects.toMatchObject({
    detail: "Not signed in",
    status: 401,
  });
});

test("a network failure passes through the interceptor untouched, still an Error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await expect(getCurrentCoach({ throwOnError: true })).rejects.toBeInstanceOf(TypeError);
});

// A 404/401/403/422 etc. is never going to succeed by trying again — a stale
// opponent key, an expired session — so a caller checking isError/getErrorStatus
// (e.g. player-record-card.tsx's opponent-not-found recovery) shouldn't have to
// wait out TanStack Query's default multi-second backoff first.
test("gives up immediately on a 4xx other than 429", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    expect(shouldRetryQuery(0, { status })).toBe(false);
  }
});

test("keeps retrying a 429 — that's what its own backoff is for", () => {
  expect(shouldRetryQuery(0, { status: 429 })).toBe(true);
});

test("keeps retrying a 5xx or a status-less network failure, up to the default budget", () => {
  expect(shouldRetryQuery(0, { status: 500 })).toBe(true);
  expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
  expect(shouldRetryQuery(2, { status: 500 })).toBe(true);
  expect(shouldRetryQuery(3, { status: 500 })).toBe(false);
});
