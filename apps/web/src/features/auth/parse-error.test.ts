import { expect, test } from "vitest";

import { parseErrorMessage } from "./parse-error";

test("returns a string detail as-is", async () => {
  const response = new Response(JSON.stringify({ detail: "Incorrect email or password" }));

  expect(await parseErrorMessage(response, "fallback")).toBe("Incorrect email or password");
});

test("joins a 422 validation array's messages", async () => {
  // A real FastAPI 422 body, not a hand-written {detail: "..."} — the shape this
  // exists to handle.
  const response = new Response(
    JSON.stringify({
      detail: [
        { loc: ["body", "display_name"], msg: "Field required", type: "missing" },
        {
          loc: ["body", "password"],
          msg: "String should have at least 8 characters",
          type: "string_too_short",
        },
      ],
    }),
  );

  expect(await parseErrorMessage(response, "fallback")).toBe(
    "Field required String should have at least 8 characters",
  );
});

test("falls back when detail is missing", async () => {
  const response = new Response(JSON.stringify({}));

  expect(await parseErrorMessage(response, "fallback")).toBe("fallback");
});

test("falls back when the body isn't JSON", async () => {
  const response = new Response("<html>not json</html>");

  expect(await parseErrorMessage(response, "fallback")).toBe("fallback");
});

test("falls back when the validation array is empty or unrecognisable", async () => {
  const response = new Response(JSON.stringify({ detail: [{ unexpected: "shape" }] }));

  expect(await parseErrorMessage(response, "fallback")).toBe("fallback");
});
