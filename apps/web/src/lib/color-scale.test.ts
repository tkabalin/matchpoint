import { expect, test } from "vitest";

import { interpolateSeverityColor } from "./color-scale";

test("weakest end matches the vermillion anchor", () => {
  expect(interpolateSeverityColor(0)).toBe("#9c3d0a");
});

test("midpoint matches the orange anchor", () => {
  expect(interpolateSeverityColor(0.5)).toBe("#e69f00");
});

test("strongest end matches the jade green anchor", () => {
  expect(interpolateSeverityColor(1)).toBe("#1fbf8c");
});

test("clamps values outside 0-1", () => {
  expect(interpolateSeverityColor(-1)).toBe(interpolateSeverityColor(0));
  expect(interpolateSeverityColor(2)).toBe(interpolateSeverityColor(1));
});
