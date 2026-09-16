import type { CourtZoneCount } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { FinalBallCourt } from "./final-ball-court";

const ZONES: CourtZoneCount[] = [
  { zone: "Ad short", count: 5 },
  { zone: "Deuce short", count: 3 },
  { zone: "Ad deep", count: 1 },
  { zone: "Deuce deep", count: 1 },
  // Out-of-bounds zones a real payload can still carry — this chart no longer
  // draws or counts them at all.
  { zone: "Net", count: 4 },
  { zone: "Long", count: 2 },
  { zone: "Wide", count: 1 },
];

test("prints each zone's raw count, ignoring net/long/wide", () => {
  render(<FinalBallCourt zones={ZONES} wonSide="you" />);

  expect(
    screen.getByRole("img", {
      name: "Final ball landing zones: Ad short 5, Deuce short 3, Ad deep 1, Deuce deep 1",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("5")).toBeInTheDocument();
  expect(screen.getAllByText("1")).toHaveLength(2);
  // The majority comparison still runs on each zone's share of the total —
  // only what's printed changed, from that share to the raw count behind it.
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

test("draws no net/long/wide markers", () => {
  render(<FinalBallCourt zones={ZONES} wonSide="you" />);

  expect(screen.queryByText(/NET/)).not.toBeInTheDocument();
  expect(screen.queryByText(/LONG/)).not.toBeInTheDocument();
  expect(screen.queryByText(/WIDE/)).not.toBeInTheDocument();
});

test("a style scoped to points won colors its majority zone with the win pattern", () => {
  const { container } = render(<FinalBallCourt zones={ZONES} wonSide="you" />);

  const majorityCell = Array.from(container.querySelectorAll("rect")).find(
    (rect) => rect.getAttribute("fill") === "url(#final-ball-win)",
  );
  expect(majorityCell).toBeTruthy();
  expect(container.querySelector('rect[fill="url(#final-ball-loss)"]')).not.toBeInTheDocument();
});

test("a style scoped to points lost colors its majority zone with the loss (vermillion) pattern", () => {
  const { container } = render(<FinalBallCourt zones={ZONES} wonSide="opponents" />);

  expect(container.querySelector('rect[fill="url(#final-ball-loss)"]')).toBeTruthy();
  expect(container.querySelector('rect[fill="url(#final-ball-win)"]')).not.toBeInTheDocument();
});

// The net is always against the "short" row — a court-geometry fact — so its
// position has to move with the same `flip` that reorders the rows, not sit
// fixed at the bottom regardless (rally-tab.tsx passes `flip={wonSide ===
// "you"}`, so this is what "You lost" actually renders without it).
test("the net graphic moves to the top when not flipped, matching the row order", () => {
  const { container: notFlipped } = render(<FinalBallCourt zones={ZONES} wonSide="opponents" />);
  const netNotFlipped = notFlipped.querySelector('rect[fill="url(#final-ball-net)"]');
  expect(netNotFlipped).toHaveAttribute("y", "16");

  const { container: flipped } = render(<FinalBallCourt zones={ZONES} wonSide="you" flip />);
  const netFlipped = flipped.querySelector('rect[fill="url(#final-ball-net)"]');
  expect(netFlipped).toHaveAttribute("y", "216");
});

test("renders without throwing when there are no in-court zones at all", () => {
  render(<FinalBallCourt zones={[]} wonSide="you" />);

  expect(screen.getByRole("img")).toBeInTheDocument();
});
