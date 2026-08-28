/**
 * The final shot screen — which stroke ended the point.
 *
 * Reached only on a FORCED ending now that an unforced error skips it: eight cards,
 * one per wing and shot type, which is exactly what TAP_SHOT_DETAIL asks for. Whose
 * shot it was is never tapped — a Point derives that from `won` (see lastShotPlayer).
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import { COURT_ACTIONS, CourtDiagram } from "./court-diagram";
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
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-4 gap-x-2.5 gap-y-[26px] px-4 py-[52px]">
          {SHOTS.flatMap((shot) =>
            WINGS.map((wing) => (
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
                className="h-full rounded-lg border-white/70 bg-white/90 text-sm font-semibold text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white/99"
              >
                {shot.label}
              </Button>
            )),
          )}
        </div>

        {/* On the net line, as drawn — but above the mesh, which hides them in the
            prototype's own screenshot. Without these the two columns are unlabelled. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 px-[14px]">
          {WINGS.map((wing) => (
            <span
              key={wing.wing}
              className="flex h-8 flex-1 items-center justify-center rounded-md bg-white/95 text-[11px] font-semibold tracking-[0.08em] text-chart-5 uppercase shadow-[0_1px_6px_rgb(0_0_0/0.2)]"
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
