import type { FaultModeShares } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { FaultModeCourt } from "./fault-mode-court";

/** Percentages still decide the majority colour; counts are what's printed
 *  (#295) — kept genuinely different per case so a test can't pass by the
 *  two coincidentally lining up. */
function shares(
  pcts: [net: number, long: number, wide: number],
  counts: [net: number, long: number, wide: number],
): FaultModeShares {
  return {
    net: pcts[0],
    long: pcts[1],
    wide: pcts[2],
    net_count: counts[0],
    long_count: counts[1],
    wide_count: counts[2],
  };
}

const SHARES = shares([55, 20, 25], [11, 4, 5]);

test("renders one accessible label naming all three raw counts", () => {
  render(<FaultModeCourt shares={SHARES} />);

  expect(
    screen.getByRole("img", { name: "Fault mode: net 11, long 4, wide 5" }),
  ).toBeInTheDocument();
});

// The majority colour is still decided by share, not count — a mode with
// fewer faults overall can still be this match's own majority mode.
test("colours by percentage even when the raw counts alone would suggest otherwise", () => {
  const { container } = render(<FaultModeCourt shares={shares([60, 20, 20], [3, 1, 1])} />);

  expect(screen.getByText(/LONG 1/)).toBeInTheDocument();
  expect(screen.getByText(/NET 3/)).toBeInTheDocument();
  expect(container.querySelectorAll('rect[fill="url(#fault-court-majority)"]')).toHaveLength(1);
});

// Both serve cards face the same way — a fault mode has no "own serve vs.
// opponent's serve" side the way a rally's landing zone does, so this court
// carries no `flip` prop at all. Long sits at the top (pointing away off the
// far edge) and net at the bottom, matching the app's reference court orientation.
test("labels the top out-zone Long and the bottom Net", () => {
  render(<FaultModeCourt shares={SHARES} />);
  expect(screen.getByText(/LONG 4/)).toBeInTheDocument();
  expect(screen.getByText(/NET 11/)).toBeInTheDocument();
});

// The wide out-zone renders on both sides of the court but only labels one, to
// avoid printing "WIDE 5" twice for a single share.
test("prints the wide count exactly once", () => {
  render(<FaultModeCourt shares={SHARES} />);

  expect(screen.getAllByText(/WIDE 5/)).toHaveLength(1);
});

test("a fault mode with no clear majority still renders without throwing", () => {
  render(<FaultModeCourt shares={shares([34, 33, 33], [7, 7, 6])} />);

  expect(screen.getByRole("img")).toBeInTheDocument();
});

test("never prints a percentage sign anywhere on the court", () => {
  render(<FaultModeCourt shares={SHARES} />);

  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});
