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

// How far inside a final-ball zone's own edges the square below stays — the zone's
// boundary lines (baseline, service line, alley, centre line) sit exactly on those
// edges, so without this margin the zoomed-in view would still show them. Sized for the
// net specifically, not the thinner percentage-based lines: court-diagram.tsx draws it
// at a fixed 26px regardless of the court's own rendered size, so on a short court (a
// landscape phone, header and actions band eating most of the height) a small
// percentage margin can still be thinner than the net's own reach. 7 comfortably clears
// it even there; the six zones with no line that close just zoom in a little further
// than the minimum they needed, which court-diagram.tsx's ZoomedCard renders correctly
// at any scale.
const LINE_MARGIN = 7;

/**
 * The largest square centred on `region`'s own centre and kept `margin` clear of its
 * edges — the actual zoom target and card canvas for rally length, ending and final
 * shot, in place of the final-ball zone's own real box. A final-ball zone is a lot
 * wider than it is tall, so zooming its exact bounds (as this used to) always left
 * slack on one axis — see zoomScale's own comment — and, more visibly, put the zone's
 * boundary lines inside the frame, since those lines sit exactly on the zone's edges. A
 * square, by contrast, always matches court-diagram.tsx's own frame aspect exactly (a
 * consequence of a percentage box's real aspect scaling by the *court's* own 165:216
 * ratio, which cancels out precisely when width% equals height% — see this file's own
 * test), so contain-fit fills the frame completely, and staying inside the margin keeps
 * every edge on plain court colour. The trade-off is a smaller canvas than the full
 * zone; the payoff is that all of it is buttons rather than some of it being lines.
 */
export function interiorSquare(region: CourtRegion, margin = LINE_MARGIN): CourtRegion {
  const size = Math.min(region.width, region.height) - margin * 2;
  const centerX = region.left + region.width / 2;
  const centerY = region.top + region.height / 2;
  return { left: centerX - size / 2, top: centerY - size / 2, width: size, height: size };
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
