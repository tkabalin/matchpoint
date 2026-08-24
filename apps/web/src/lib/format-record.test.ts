import { expect, test } from "vitest";

import { formatRecord } from "./format-record";

test("marks which number is wins and which is losses", () => {
  expect(formatRecord(14, 15)).toBe("14W – 15L");
});

test("handles a shutout in either direction", () => {
  expect(formatRecord(3, 0)).toBe("3W – 0L");
  expect(formatRecord(0, 3)).toBe("0W – 3L");
});
