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

test("percentages are a share of the four in-court zones only, ignoring net/long/wide", () => {
  render(<FinalBallCourt zones={ZONES} wonSide="you" />);

  // 5+3+1+1 = 10, so 50/30/10/10 — not diluted by the 7 out-of-bounds points.
  expect(
    screen.getByRole("img", {
      name: "Final ball landing zones: Ad short 50%, Deuce short 30%, Ad deep 10%, Deuce deep 10%",
    }),
  ).toBeInTheDocument();
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

test("renders without throwing when there are no in-court zones at all", () => {
  render(<FinalBallCourt zones={[]} wonSide="you" />);

  expect(screen.getByRole("img")).toBeInTheDocument();
});
