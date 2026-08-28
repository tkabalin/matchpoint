/**
 * The final shot screen — which stroke ended the point.
 *
 * Reached only on a FORCED ending now that an unforced error skips it: eight cards,
 * one per wing and shot type, which is exactly what TAP_SHOT_DETAIL asks for. Whose
 * shot it was is never tapped — a Point derives that from `won` (see lastShotPlayer).
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import {
  COURT_ACTIONS,
  COURT_COLUMNS,
  COURT_REGION_COLUMNS,
  COURT_REGION_GRID,
  COURT_ROWS,
  CourtDiagram,
} from "./court-diagram";
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

export function FinalShotScreen({ onAction }: { onAction: (action: CaptureAction) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Final shot</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Pick the shot that ended the point</p>
      </div>

      <CourtDiagram className="min-h-0 flex-1">
        {/* One card per court region: a row per shot type, a column per wing. */}
        <div className="absolute inset-0 grid" style={COURT_REGION_GRID}>
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
                style={{ gridColumn: COURT_COLUMNS[wingIndex], gridRow: COURT_ROWS[shotIndex] }}
                // A region is narrow in landscape, where the court is height-bound, so
                // the label wraps rather than running past the card it sits in.
                className="m-[3px] h-auto rounded-lg border-white/70 bg-white/90 px-1 text-center text-sm font-semibold whitespace-normal text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white/99"
              >
                {shot.label}
              </Button>
            )),
          )}
        </div>

        {/* On the net line, as drawn — but above the mesh, which hides them in the
            prototype's own screenshot. Without these the two columns are unlabelled, and
            each sits over the column it names so it lines up with those cards. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-30 grid -translate-y-1/2 items-center"
          style={{ gridTemplateColumns: COURT_REGION_COLUMNS }}
        >
          {WINGS.map((wing, wingIndex) => (
            <span
              key={wing.wing}
              style={{ gridColumn: COURT_COLUMNS[wingIndex] }}
              className="flex h-8 items-center justify-center rounded-md bg-white/95 text-[11px] font-semibold tracking-[0.08em] text-chart-5 uppercase shadow-[0_1px_6px_rgb(0_0_0/0.2)]"
            >
              {wing.label}
            </span>
          ))}
        </div>
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
