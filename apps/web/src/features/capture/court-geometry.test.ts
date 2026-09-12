import { expect, test } from "vitest";

import {
  finalBallZoneRegion,
  interiorSquare,
  subCells,
  toCourtBox,
  zoomScale,
} from "./court-geometry";

test("zoomScale picks the smaller of the two axes' own fill scales, never cropping either", () => {
  // A 50%-wide, 25%-tall region: width only needs 2x to fill, height would take 4x —
  // 2x is the answer, since going further would push width past 100% (cropping it).
  expect(zoomScale({ left: 0, top: 0, width: 50, height: 25 })).toBe(2);
  // Height-bound: the roles reverse.
  expect(zoomScale({ left: 0, top: 0, width: 25, height: 50 })).toBe(2);
  // Square region, either axis agrees.
  expect(zoomScale({ left: 0, top: 0, width: 40, height: 40 })).toBe(2.5);
});

test("toCourtBox turns a numeric region into the CSS-string box court-diagram.tsx takes", () => {
  expect(toCourtBox({ left: 15.76, top: 6.2, width: 32.72, height: 19.73 })).toEqual({
    left: "15.76%",
    top: "6.2%",
    width: "32.72%",
    height: "19.73%",
  });
});

test("subCells splits a region into an equal rows x cols grid, row-major", () => {
  const cells = subCells({ left: 0, top: 0, width: 100, height: 100 }, 2, 2);

  expect(cells).toEqual([
    { left: 0, top: 0, width: 50, height: 50 },
    { left: 50, top: 0, width: 50, height: 50 },
    { left: 0, top: 50, width: 50, height: 50 },
    { left: 50, top: 50, width: 50, height: 50 },
  ]);
});

test("subCells scales to the caller's own region, not just the whole court", () => {
  const cells = subCells({ left: 20, top: 40, width: 40, height: 20 }, 1, 4);

  expect(cells).toEqual([
    { left: 20, top: 40, width: 10, height: 20 },
    { left: 30, top: 40, width: 10, height: 20 },
    { left: 40, top: 40, width: 10, height: 20 },
    { left: 50, top: 40, width: 10, height: 20 },
  ]);
});

test.each([
  [
    true,
    { half: "DEUCE", depth: "DEEP" } as const,
    { left: 15.76, top: 6.2, width: 32.72, height: 19.73 },
  ],
  [
    false,
    { half: "AD", depth: "SHORT" } as const,
    { left: 15.76, top: 50, width: 32.72, height: 21.76 },
  ],
])(
  "finalBallZoneRegion(won=%s, %o) matches the final ball screen's own zone",
  (won, zone, expected) => {
    expect(finalBallZoneRegion(won, zone)).toEqual(expected);
  },
);

test("interiorSquare shrinks to the smaller axis, minus the margin on each side, centred", () => {
  // Landscape region: height (20) is the smaller axis, so the square's side is 20 minus
  // 2 x the margin, centred on the same point (left 15 + 20/2 = 25, top 30 + 20/2 = 40).
  expect(interiorSquare({ left: 15, top: 30, width: 40, height: 20 }, 2)).toEqual({
    left: 27,
    top: 32,
    width: 16,
    height: 16,
  });
});

test("interiorSquare always matches the court's own 165:216 aspect, in real units", () => {
  const square = interiorSquare({ left: 15.76, top: 6.2, width: 32.72, height: 19.73 });

  // Equal percentages of two differently-sized axes (165 wide, 216 tall) only produce
  // the same real aspect ratio, 165:216, when the axes themselves are scaled by those
  // same two numbers — which is exactly what happens once width% equals height%.
  const realWidth = (square.width / 100) * 165;
  const realHeight = (square.height / 100) * 216;
  expect(realWidth / realHeight).toBeCloseTo(165 / 216);
});
