import type { RallyTrendPoint } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { RallyHypnogram } from "./rally-hypnogram";

const TREND: RallyTrendPoint[] = [
  {
    match: "M1",
    long_rally_share: 10,
    result: "win",
    went_the_distance: false,
  },
  {
    match: "M2",
    long_rally_share: 55,
    result: "loss",
    went_the_distance: true,
  },
  {
    match: "M3",
    long_rally_share: 30,
    result: null,
    went_the_distance: null,
  },
];

test("shows the card heading and caption", () => {
  render(<RallyHypnogram trend={TREND} />);

  expect(screen.getByText("Rally intensity: how matches are going")).toBeInTheDocument();
  expect(
    screen.getByText("Share of that match's points running past 5 shots · oldest to most recent"),
  ).toBeInTheDocument();
});

test("shows a legend for won, lost, no result yet, and went the distance", () => {
  render(<RallyHypnogram trend={TREND} />);

  expect(screen.getByText("Won")).toBeInTheDocument();
  expect(screen.getByText("Lost")).toBeInTheDocument();
  expect(screen.getByText("No result yet")).toBeInTheDocument();
  expect(screen.getByText("Went the distance")).toBeInTheDocument();
});

test("draws one bar per match", () => {
  const { container } = render(<RallyHypnogram trend={TREND} />);

  // One <rect> per bar from the custom RallyBar shape, keyed by result fill.
  const bars = Array.from(container.querySelectorAll("rect")).filter((rect) =>
    ["var(--color-outcome-win)", "url(#chart-pattern-loss)", "var(--muted-foreground)"].includes(
      rect.getAttribute("fill") ?? "",
    ),
  );
  expect(bars).toHaveLength(3);
});

// Colour alone isn't enough for accessibility: a lost bar must be
// structurally distinguishable from a won one, not just a different hue.
test("a won bar is a plain solid fill, a lost bar carries the diagonal-stripe pattern", () => {
  const { container } = render(<RallyHypnogram trend={TREND} />);

  const wonBar = container.querySelector('rect[fill="var(--color-outcome-win)"]');
  const lostBar = container.querySelector('rect[fill="url(#chart-pattern-loss)"]');
  expect(wonBar).toBeInTheDocument();
  expect(lostBar).toBeInTheDocument();
  expect(container.querySelector("pattern#chart-pattern-loss")).toBeInTheDocument();
});

test("marks only the match that went the distance", () => {
  const { container } = render(<RallyHypnogram trend={TREND} />);

  // Scoped to the chart itself: the legend row below it has its own small
  // amber diamond icon using the same fill, which isn't a per-match marker.
  const chart = container.querySelector('[data-slot="chart"]')!;
  const markers = chart.querySelectorAll('path[fill="var(--color-outcome-forced)"]');
  expect(markers).toHaveLength(1);
});

test("shows an empty state when there are no matches to plot", () => {
  render(<RallyHypnogram trend={[]} />);

  expect(screen.getByText("No matches with a rally length recorded yet.")).toBeInTheDocument();
  expect(screen.queryByText("Won")).not.toBeInTheDocument();
});

// A stale snapshot restored from the persisted query cache (query-persist.ts) can
// predate `trend` existing on RallyStats at all, so `undefined` is a real runtime
// shape this has to survive even though the type says it never happens.
test("falls back to the empty state rather than crashing when trend is missing entirely", () => {
  render(<RallyHypnogram trend={undefined as unknown as RallyTrendPoint[]} />);

  expect(screen.getByText("No matches with a rally length recorded yet.")).toBeInTheDocument();
});
