import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ShotRadar } from "./shot-radar";

const shots = [
  { shot: "FH drive", share: 0.4 },
  { shot: "BH drive", share: 0.3 },
  { shot: "FH volley", share: 0.2 },
  { shot: "BH volley", share: 0.1 },
];

function styleText(): string {
  return [...document.querySelectorAll("style")].map((node) => node.textContent ?? "").join("\n");
}

test("draws a labelled axis per shot", () => {
  render(<ShotRadar series={[{ name: "Share of point-enders", color: "red", points: shots }]} />);

  for (const { shot } of shots) {
    expect(screen.getByText(shot)).toBeInTheDocument();
  }
});

// A series name is a display string, but its key reaches CSS as `--color-<key>`. When
// the name was used directly, "Share of point-enders" produced a property name with
// spaces in it, and a browser discards the entire rule block rather than that one
// declaration — so every colour the chart declared went with it.
test("a series named in prose still emits a parseable custom property", () => {
  render(<ShotRadar series={[{ name: "Share of point-enders", color: "red", points: shots }]} />);

  expect(styleText()).toContain("--color-share-of-point-enders:");
  expect(styleText()).not.toMatch(/--color-[^:]*\s[^:]*:/);
});

test("an overlay keeps one property per series", () => {
  render(
    <ShotRadar
      series={[
        { name: "You", color: "red", points: shots },
        { name: "Sarah K", color: "blue", points: shots },
      ]}
    />,
  );

  expect(styleText()).toContain("--color-you:");
  expect(styleText()).toContain("--color-sarah-k:");
});

// The caller maps whatever the analytics returned, which can be nothing at all.
test("renders nothing when there is no series to draw", () => {
  const { container } = render(<ShotRadar series={[]} />);

  expect(container).toBeEmptyDOMElement();
});
