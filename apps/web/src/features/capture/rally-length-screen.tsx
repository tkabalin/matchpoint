/**
 * The rally length screen — how many shots the point ran to.
 *
 * Four cards, one per stored bucket, laid on the court's own regions; the first tap
 * moves on. Asked straight after the final ball, while the count is still fresh.
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import { CourtDiagram } from "./court-diagram";
import { COURT_COLUMNS, COURT_HALF_ROWS, COURT_REGION_GRID } from "./court-regions";
import type { RallyBucket } from "./point";

// The four stored buckets, in the coach's own vocabulary. B1 is also what the flow
// fills in for an ace or a double fault, where there was no rally to ask about.
const BUCKET_LABELS: { bucket: RallyBucket; label: string }[] = [
  { bucket: "B1", label: "1-2" },
  { bucket: "B2", label: "3-5" },
  { bucket: "B3", label: "6-10" },
  { bucket: "B4", label: "11+" },
];

export function RallyLengthScreen({ onAction }: { onAction: (action: CaptureAction) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Rally length</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">How many shots were played</p>
      </div>

      <CourtDiagram netLabel="Shots" className="min-h-0 flex-1">
        {/* One card per quarter of the court, backcourt and service box together: the
            two short buckets beyond the net, the two long ones this side of it. */}
        <div className="absolute inset-0 grid" style={COURT_REGION_GRID}>
          {BUCKET_LABELS.map(({ bucket, label }, index) => (
            <Button
              key={bucket}
              variant="ghost"
              onClick={() => {
                onAction({ type: "TAP_RALLY_LENGTH", bucket });
              }}
              style={{
                gridColumn: COURT_COLUMNS[index % 2],
                gridRow: index < 2 ? COURT_HALF_ROWS.far : COURT_HALF_ROWS.near,
              }}
              // Opaque, unlike the shot screen's cards: a card spanning the court's lines
              // would show them through a translucent white.
              className="m-[3px] h-auto rounded-lg border-white/70 bg-[color-mix(in_oklch,var(--color-court)_8%,white)] px-1 text-xl font-semibold text-foreground tabular-nums shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white"
            >
              {label}
            </Button>
          ))}
        </div>
      </CourtDiagram>
    </div>
  );
}
