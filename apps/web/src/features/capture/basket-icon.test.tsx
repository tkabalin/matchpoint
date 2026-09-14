import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { BasketIcon } from "./basket-icon";

test.each([
  ["B1", 2],
  ["B2", 5],
  ["B3", 10],
])("%s draws %i balls, no overflow", (bucket, count) => {
  const { container } = render(<BasketIcon bucket={bucket as "B1" | "B2" | "B3"} />);

  expect(container.querySelectorAll("circle")).toHaveLength(count);
});

test("B4 fills the basket and spills three balls out in front", () => {
  const { container } = render(<BasketIcon bucket="B4" />);

  expect(container.querySelectorAll("circle")).toHaveLength(13);
});

test("the basket itself is decorative — no accessible text of its own", () => {
  const { container } = render(<BasketIcon bucket="B1" />);

  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});
