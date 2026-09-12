import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { UnforcedIcon } from "./unforced-icon";

test("is decorative — no accessible text of its own", () => {
  const { container } = render(<UnforcedIcon />);

  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

test("a caller can still size and pass through props, same as a Lucide icon", () => {
  const { container } = render(<UnforcedIcon className="size-7" data-testid="unforced" />);

  const svg = container.querySelector("svg");
  expect(svg).toHaveClass("size-7");
  expect(svg).toHaveAttribute("data-testid", "unforced");
});
