import { expect, test } from "vitest";

import { parseErrorMessage } from "./parse-error";

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
