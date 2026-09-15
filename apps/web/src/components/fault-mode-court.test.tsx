import type { FaultModeShares } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { FaultModeCourt } from "./fault-mode-court";

const SHARES: FaultModeShares = { net: 55, long: 20, wide: 25 };

test("renders one accessible label naming all three shares", () => {
  render(<FaultModeCourt shares={SHARES} />);

  expect(
    screen.getByRole("img", { name: "Fault mode: net 55%, long 20%, wide 25%" }),
  ).toBeInTheDocument();
});

// FaultModeShares' three numbers are each rounded independently server-side and
// don't reliably sum to 100 — this locks in that what's drawn (and printed) always
// does, regardless of what the raw shares add up to.
test("renormalises shares that don't sum to 100", () => {
  render(<FaultModeCourt shares={{ net: 40, long: 20, wide: 20 }} />);

  // 40+20+20=80 raw, so renormalised: net 50%, long 25%, wide 25%.
  expect(
    screen.getByRole("img", { name: "Fault mode: net 50%, long 25%, wide 25%" }),
  ).toBeInTheDocument();
});

// Both serve cards face the same way — a fault mode has no "own serve vs.
// opponent's serve" side the way a rally's landing zone does, so this court
// carries no `flip` prop at all. Long sits at the top (pointing away off the
// far edge) and net at the bottom, matching the app's reference court orientation.
test("labels the top out-zone Long and the bottom Net", () => {
  render(<FaultModeCourt shares={SHARES} />);
  expect(screen.getByText(/LONG 20%/)).toBeInTheDocument();
  expect(screen.getByText(/NET 55%/)).toBeInTheDocument();
});

// The wide out-zone renders on both sides of the court but only labels one, to
// avoid printing "WIDE 25%" twice for a single share.
test("prints the wide share exactly once", () => {
  render(<FaultModeCourt shares={SHARES} />);

  expect(screen.getAllByText(/WIDE 25%/)).toHaveLength(1);
});

test("a fault mode with no clear majority still renders without throwing", () => {
  render(<FaultModeCourt shares={{ net: 34, long: 33, wide: 33 }} />);

  expect(screen.getByRole("img")).toBeInTheDocument();
});
