import { afterEach, expect, test, vi } from "vitest";

import { getRetryAfterSeconds, parseErrorMessage } from "./parse-error";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("returns a string detail as-is", () => {
  expect(parseErrorMessage({ detail: "Incorrect email or password" }, "fallback")).toBe(
    "Incorrect email or password",
  );
});

test("joins a 422 validation array's messages", () => {
  // A real FastAPI 422 body shape, not a hand-written {detail: "..."} — the shape
  // this exists to handle (#51).
  const error = {
    detail: [
      { loc: ["body", "display_name"], msg: "Field required", type: "missing" },
      {
        loc: ["body", "password"],
        msg: "String should have at least 8 characters",
        type: "string_too_short",
      },
    ],
  };

  expect(parseErrorMessage(error, "fallback")).toBe(
    "Field required String should have at least 8 characters",
  );
});

test("falls back when detail is missing", () => {
  expect(parseErrorMessage({ detail: undefined }, "fallback")).toBe("fallback");
});

test("falls back when the validation array is empty or unrecognisable", () => {
  expect(parseErrorMessage({ detail: [{ loc: [], msg: "", type: "" }] }, "fallback")).toBe(
    "fallback",
  );
});

test("falls back when there is no error at all", () => {
  expect(parseErrorMessage(undefined, "fallback")).toBe("fallback");
});

test("reports a network failure distinctly from an API error", () => {
  expect(parseErrorMessage(new TypeError("Failed to fetch"), "fallback")).toBe(
    "Could not reach the server. Try again.",
  );
});

test("reads Retry-After off a 429 response", () => {
  const response = new Response(null, { status: 429, headers: { "Retry-After": "45" } });

  expect(getRetryAfterSeconds(response)).toBe(45);
});

test("returns null when there is no Retry-After header", () => {
  const response = new Response(null, { status: 429 });

  expect(getRetryAfterSeconds(response)).toBeNull();
});

test("returns null when the response itself is undefined", () => {
  expect(getRetryAfterSeconds(undefined)).toBeNull();
});

test("returns null for a non-numeric or non-positive Retry-After", () => {
  expect(
    getRetryAfterSeconds(new Response(null, { headers: { "Retry-After": "soon" } })),
  ).toBeNull();
  expect(getRetryAfterSeconds(new Response(null, { headers: { "Retry-After": "0" } }))).toBeNull();
});
