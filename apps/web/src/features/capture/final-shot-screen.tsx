/**
 * The final shot screen — which stroke ended the point.
 *
 * Reached only on a FORCED ending now that an unforced error skips it: eight cards, one
 * per wing and shot type, laid inside the region the final ball zoomed into (reached
 * last in the flow, so no entrance animation of its own — see rally-length-screen.tsx).
 * Whose shot it was is never tapped — a Point derives that from `won` (see
 * lastShotPlayer).
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { COURT_ACTIONS, CourtDiagram } from "./court-diagram";
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

export function FinalShotScreen({
  zoomTo,
  onAction,
}: {
  /** The region the final ball landed in — see court-geometry.ts's own comment. */
  zoomTo: CourtRegion;
  onAction: (action: CaptureAction) => void;
}) {
  // subCells(zoomTo, 4, 2) always returns exactly 8 regions, one per wing/shot pair below.
  const cells = subCells(zoomTo, 4, 2);
  // A card's text would come out `scale` times too big once the court's own zoom
  // transform enlarges it along with everything else — see court-diagram.tsx's own
  // comment on zoomScale.
  const scale = zoomScale(zoomTo);
  const kickerSize = 10 / scale;
  const labelSize = 14 / scale;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Final shot</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Pick the shot that ended the point</p>
      </div>

      <CourtDiagram zoomTo={zoomTo} className="min-h-0 flex-1">
        {SHOTS.flatMap((shot, shotIndex) =>
          WINGS.map((wing, wingIndex) => (
            <Button
              key={`${wing.wing}-${shot.shotType}`}
              variant="ghost"
              aria-label={`${wing.label} ${shot.label.toLowerCase()}`}
              onClick={() => {
                onAction({
                  type: "TAP_SHOT_DETAIL",
                  wing: wing.wing,
                  shotType: shot.shotType,
                });
              }}
              style={{
                ...toCourtBox(cells[shotIndex * 2 + wingIndex]!),
                gap: `${String(2 / scale)}px`,
              }}
              className="absolute m-[3px] flex-col rounded-lg border-white/70 bg-white/90 text-center whitespace-normal text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white/99"
            >
              {/* Only the top row spells out the wing — a coach reads it once and the
                  column keeps its meaning down the rest of that side, the same way the
                  final ball screen's baseline chips only need to appear once a half. */}
              {shotIndex === 0 && (
                <span
                  style={{ fontSize: `${String(kickerSize)}px` }}
                  className="font-semibold tracking-[0.08em] text-chart-5 uppercase"
                >
                  {wing.label}
                </span>
              )}
              <span style={{ fontSize: `${String(labelSize)}px` }} className="font-semibold">
                {shot.label}
              </span>
            </Button>
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
