import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { CourtHeatmap } from "./court-heatmap";

const ZONES = [
  { zone: "Deuce short", count: 0 },
  { zone: "Deuce deep", count: 2 },
  { zone: "Ad short", count: 0 },
  { zone: "Ad deep", count: 0 },
  { zone: "Net", count: 3 },
  { zone: "Long", count: 2 },
  { zone: "Wide", count: 1 },
];

test("renders the court diagram and the heat legend", () => {
  render(<CourtHeatmap zones={ZONES} />);

  expect(screen.getByRole("img", { name: "Final ball landing zones" })).toBeInTheDocument();
  expect(screen.getByText("Least common")).toBeInTheDocument();
  expect(screen.getByText("Most common")).toBeInTheDocument();
});

test("labels each zone with its share of the total", () => {
  render(<CourtHeatmap zones={ZONES} />);

  // 8 total points; Net = 3 → 38%.
  expect(screen.getByText("NET 38%")).toBeInTheDocument();
});

// There's one `Wide` count, not a left and a right — the diagram used to
// print "WIDE 13%" on both sidelines, which read as two separate 13% zones
// and pushed the percentages shown past 100% in total.
test("labels the single Wide zone once, not on both sidelines", () => {
  render(<CourtHeatmap zones={ZONES} />);

  // 8 total points; Wide = 1 → 13%.
  expect(screen.getAllByText("WIDE 13%")).toHaveLength(1);
});

test("handles every zone at zero without dividing by zero", () => {
  render(<CourtHeatmap zones={ZONES.map((zone) => ({ ...zone, count: 0 }))} />);

  expect(screen.getByRole("img", { name: "Final ball landing zones" })).toBeInTheDocument();
});

// The API still declares (though capture can no longer produce, and #248 will
// remove) two "mid" zones. Counting them in the total is the silent-skew bug
// #232 flagged: a zone this diagram never draws still lowered every rendered
// percentage. This locks in that percentages are computed only over the seven
// zones actually drawn.
test("a zone the diagram never draws does not skew the percentages of the ones it does", () => {
  const withMidZones = [...ZONES, { zone: "Deuce mid", count: 5 }, { zone: "Ad mid", count: 5 }];

  render(<CourtHeatmap zones={withMidZones} />);

  // Same 38% as the base fixture (Net 3 of 8 drawn points) — unmoved by the
  // extra 10 points sitting in zones this diagram doesn't render.
  expect(screen.getByText("NET 38%")).toBeInTheDocument();
});

test("flip swaps net and long between the top and bottom bars", () => {
  const { unmount } = render(<CourtHeatmap zones={ZONES} />);
  const unflippedNetY = Number(screen.getByText("NET 38%").getAttribute("y"));
  const unflippedLongY = Number(screen.getByText("LONG 25%").getAttribute("y"));
  expect(unflippedNetY).toBeLessThan(unflippedLongY);
  unmount();

  render(<CourtHeatmap zones={ZONES} flip />);
  const flippedNetY = Number(screen.getByText("NET 38%").getAttribute("y"));
  const flippedLongY = Number(screen.getByText("LONG 25%").getAttribute("y"));
  expect(flippedNetY).toBeGreaterThan(flippedLongY);
});
