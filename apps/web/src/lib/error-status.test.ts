import { getCurrentCoach } from "@matchpoint/api-client";
import { afterEach, expect, test, vi } from "vitest";

import { getErrorStatus } from "./error-status";

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
