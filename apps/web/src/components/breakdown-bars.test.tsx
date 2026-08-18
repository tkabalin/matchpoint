import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { BreakdownBars } from "./breakdown-bars";

/**
 * Regression coverage for a bug Thomas caught reviewing !126: `max: 0` (a group
 * where nothing has been recorded yet, the ordinary first-match case) made the
 * fill width `NaN%`, which the browser drops — the bar rendered with no fill
 * signal at all rather than as a legitimately empty one.
 */
test("renders a zero-width fill, not a dropped style, when the group's ceiling is zero", () => {
  const { container } = render(<BreakdownBars rows={[{ label: "Forehand", value: 0, max: 0 }]} />);

  const fill = container.querySelector('[style*="width"]');
  expect(fill).not.toBeNull();
  expect(fill).toHaveStyle({ width: "0%" });
});

test("still fills proportionally against a real ceiling", () => {
  const { container } = render(<BreakdownBars rows={[{ label: "Forehand", value: 3, max: 12 }]} />);

  expect(container.querySelector('[style*="width"]')).toHaveStyle({ width: "25%" });
});
