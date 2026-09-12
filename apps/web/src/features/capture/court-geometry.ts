/**
 * Percentage-space boxes on the court, shared by every screen that positions cards or
 * computes a zoom target rather than drawing court-diagram.tsx's own fixed furniture.
 *
 * Replaces the CSS-grid regions this module used to export (COURT_REGION_GRID and
 * friends): once the follow-up screens' cards had to live inside whatever region the
 * final ball zoomed into rather than spanning the whole court, a fixed grid template
 * sized for the whole court stopped fitting any of them. Plain percentage boxes,
 * subdivided by `subCells`, work at any size — the whole court or one zoomed quadrant.
 */

import type { CourtBox, CourtRegion } from "./court-diagram";
import type { CourtDepth, CourtSide, CourtZone } from "./point";

// The percentages behind the final ball screen's eight zones, factored out here so the
// zoom target it hands the following screens is computed from the exact same numbers
// that drew the zone the coach tapped — see final-ball-screen.tsx's own use of these.
const COLUMN_BOXES: { left: number; width: number }[] = [
  { left: 15.76, width: 32.72 },
  { left: 48.48, width: 35.76 },
];

const DEPTH_BANDS: Record<"far" | "near", Record<CourtDepth, { top: number; height: number }>> = {
  far: {
    DEEP: { top: 6.2, height: 19.73 },
    SHORT: { top: 25.93, height: 24.07 },
  },
  near: {
    SHORT: { top: 50, height: 21.76 },
    DEEP: { top: 71.76, height: 22.04 },
  },
};

// Deuce is to the right of whoever stands on that half, so the far half reads deuce/ad
// left to right and the near half ad/deuce — see final-ball-screen.tsx's own comment.
const HALF_SIDES: Record<"far" | "near", readonly [CourtSide, CourtSide]> = {
  far: ["DEUCE", "AD"],
  near: ["AD", "DEUCE"],
};

/**
 * The box a final-ball zone occupies, in the same court-wide percentage space
 * court-diagram.tsx's `zoomTo` and `CourtTapZone.box` both use. `won` picks the half
 * (the opponent's if our player hit the winning ball, ours if they didn't — see
 * final-ball-screen.tsx), `zone` picks the column and depth within it.
 */
export function finalBallZoneRegion(won: boolean, zone: CourtZone): CourtRegion {
  const end = won ? "far" : "near";
  const column = HALF_SIDES[end].indexOf(zone.half);
  // column is always 0 or 1 — indexOf always finds zone.half in HALF_SIDES[end], which
  // lists both CourtSide values.
  return { ...COLUMN_BOXES[column]!, ...DEPTH_BANDS[end][zone.depth] };
}

/**
 * How much bigger `region` gets made to fill the diagram when it's court-diagram.tsx's
 * `zoomTo` — the factor a caller laying content inside that same region (rally-length-
 * screen.tsx and its siblings) must divide its own font sizes and gaps by, since
 * `transform: scale()` enlarges painted content exactly as it enlarges everything else
 * in the diagram. Whichever axis needs the smaller scale to close any gap wins
 * ("contain", not "cover") — the other axis then shows a little more of the court
 * beyond the region rather than cropping the region itself, which matters here because
 * the region's own content (the next screen's cards) must stay in frame.
 */
export function zoomScale(region: CourtRegion): number {
  const w = region.width / 100;
  const h = region.height / 100;
  return Math.min(1 / w, 1 / h);
}

/** `region`, as the CSS-string box court-diagram.tsx's zones and lines take directly. */
export function toCourtBox(region: CourtRegion): CourtBox {
  return {
    left: `${String(region.left)}%`,
    top: `${String(region.top)}%`,
    width: `${String(region.width)}%`,
    height: `${String(region.height)}%`,
  };
}

/**
 * Subdivides `region` into a `rows` × `cols` grid of equal, non-overlapping regions,
 * row-major (left to right, then top to bottom) — for a screen laying N cards inside
 * whatever region the coach just zoomed into rather than across the whole court.
 */
export function subCells(region: CourtRegion, rows: number, cols: number): CourtRegion[] {
  const cellWidth = region.width / cols;
  const cellHeight = region.height / rows;
  const cells: CourtRegion[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        left: region.left + col * cellWidth,
        top: region.top + row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return cells;
}
