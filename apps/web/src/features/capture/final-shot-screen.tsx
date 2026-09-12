/**
 * The final shot screen — which stroke ended the point.
 *
 * Reached only on a FORCED ending now that an unforced error skips it: eight cards, one
 * per wing and shot type, laid inside the region the final ball zoomed into (reached
 * last in the flow, so no entrance animation of its own — see rally-length-screen.tsx).
 * "Backhand"/"Forehand" caption the two columns from a strip painted on the court
 * itself, above the grid rather than inside any one card — a coach reads a column's
 * meaning once, not once per card in it, and a label on the pitch reads as part of the
 * court the way the zone labels on the final ball screen do, rather than as page chrome
 * above it. `subCells` only divides the region left after that strip is carved off the
 * top, so the button grid can't overlap it. Whose shot it was is never tapped — a Point
 * derives that from `won` (see lastShotPlayer).
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { COURT_ACTIONS, CourtDiagram, ZoomedCard } from "./court-diagram";
import { subCells, toCourtBox, zoomScale } from "./court-geometry";
import type { ShotType, Wing } from "./point";

// Rows, in the order the design lays them out. Smash and slice are deliberately absent
// from the model (see point.ts), so four rows covers every stored type.
const SHOTS: { shotType: ShotType; label: string }[] = [
  { shotType: "DRIVE", label: "Drive" },
  { shotType: "VOLLEY", label: "Volley" },
  { shotType: "DROPSHOT", label: "Drop shot" },
  { shotType: "LOB", label: "Lob" },
];

// Columns. Backhand on the left, matching the handoff.
const WINGS: { wing: Wing; label: string }[] = [
  { wing: "BACKHAND", label: "Backhand" },
  { wing: "FOREHAND", label: "Forehand" },
];

// How much of the zoomed region's own height the wing-heading strip takes off the top,
// leaving the rest for subCells' 4x2 grid — a fraction of the region rather than a fixed
// size, so it scales with whatever margin interiorSquare left around it.
const HEADER_HEIGHT_FRACTION = 0.12;

export function FinalShotScreen({
  zoomTo,
  onAction,
}: {
  /** The region the final ball landed in — see court-geometry.ts's own comment. */
  zoomTo: CourtRegion;
  onAction: (action: CaptureAction) => void;
}) {
  const scale = zoomScale(zoomTo);
  const headerRegion: CourtRegion = {
    ...zoomTo,
    height: zoomTo.height * HEADER_HEIGHT_FRACTION,
  };
  const gridRegion: CourtRegion = {
    left: zoomTo.left,
    top: zoomTo.top + headerRegion.height,
    width: zoomTo.width,
    height: zoomTo.height - headerRegion.height,
  };
  // subCells(gridRegion, 4, 2) always returns exactly 8 regions, one per wing/shot pair below.
  const cells = subCells(gridRegion, 4, 2);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Final shot</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Pick the shot that ended the point</p>
      </div>

      <CourtDiagram zoomTo={zoomTo} className="min-h-0 flex-1">
        <ZoomedCard box={toCourtBox(headerRegion)} scale={scale}>
          <div className="flex h-full w-full items-center">
            {WINGS.map((wing) => (
              <span
                key={wing.wing}
                className="flex-1 text-center text-xs font-semibold tracking-[0.08em] text-white/95 uppercase [text-shadow:0_1px_2px_rgb(0_0_0/0.25)]"
              >
                {wing.label}
              </span>
            ))}
          </div>
        </ZoomedCard>

        {SHOTS.flatMap((shot, shotIndex) =>
          WINGS.map((wing, wingIndex) => (
            <ZoomedCard
              key={`${wing.wing}-${shot.shotType}`}
              box={toCourtBox(cells[shotIndex * 2 + wingIndex]!)}
              scale={scale}
              gapClassName="p-[3px]"
            >
              <Button
                variant="ghost"
                aria-label={`${wing.label} ${shot.label.toLowerCase()}`}
                onClick={() => {
                  onAction({
                    type: "TAP_SHOT_DETAIL",
                    wing: wing.wing,
                    shotType: shot.shotType,
                  });
                }}
                className="h-full w-full rounded-lg border-white/70 bg-white/90 text-center text-sm font-semibold whitespace-normal text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white/99"
              >
                {shot.label}
              </Button>
            </ZoomedCard>
          )),
        )}
      </CourtDiagram>

      <div className={COURT_ACTIONS}>
        <Button
          variant="ghost"
          onClick={() => {
            onAction({ type: "TAP_DIDNT_SEE" });
          }}
          className="text-base font-semibold text-muted-foreground"
        >
          Didn&apos;t see the shot
        </Button>
      </div>
    </div>
  );
}
