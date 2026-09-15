/**
 * The rally length screen — how many shots the point ran to.
 *
 * Four cards, one per stored bucket, laid inside the region the final ball just zoomed
 * into; the first tap moves on. Asked straight after the final ball, while the count is
 * still fresh. Each card is the same basket-of-balls picture at a different fill level
 * (see basket-icon.tsx) rather than plain text, with the stored range as a caption —
 * the four cards read as one object getting fuller, not four unrelated buttons.
 *
 * The screen that plays the zoom-in: it mounts showing the full court (matching how the
 * final ball screen looked a moment ago), then an effect flips to the real target region
 * so court-diagram.tsx's own transition animates the camera move once. Ending and final
 * shot, reached only after this has already happened, take the target directly instead —
 * see court-diagram.tsx's own comment on `zoomTo`.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { BasketIcon } from "./basket-icon";
import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { CourtDiagram, ZoomedCard } from "./court-diagram";
import { subCells, toCourtBox } from "./court-geometry";
import type { RallyBucket } from "./point";

// The four stored buckets, in the coach's own vocabulary. B1 is also what the flow
// fills in for an ace or a double fault, where there was no rally to ask about.
const BUCKET_LABELS: { bucket: RallyBucket; label: string }[] = [
  { bucket: "B1", label: "1-2" },
  { bucket: "B2", label: "3-5" },
  { bucket: "B3", label: "6-10" },
  { bucket: "B4", label: "11+" },
];

export function RallyLengthScreen({
  zoomTo,
  onAction,
  syncStatus,
}: {
  /** The region the final ball just landed in — see court-geometry.ts's own comment. */
  zoomTo: CourtRegion;
  onAction: (action: CaptureAction) => void;
  // Sits at the right of the heading row, wrapping rather than pushing into the title.
  syncStatus?: ReactNode;
}) {
  // Starts full-court (matching the frame this screen replaces) and zooms in a beat
  // after mounting, rather than snapping straight to `zoomTo` — see this file's doc
  // comment above. Deferred to the next animation frame, not set synchronously in the
  // effect body, so the browser has actually painted the unzoomed frame first — without
  // that, the transition has nothing to animate from.
  const [cameraTarget, setCameraTarget] = useState<CourtRegion | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCameraTarget(zoomTo);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [zoomTo]);

  // subCells(zoomTo, 2, 2) always returns exactly 4 regions, one per bucket below.
  const cells = subCells(zoomTo, 2, 2);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-3xl font-semibold tracking-[-0.02em]">Rally length</h1>
          {syncStatus}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">How many shots were played</p>
      </div>

      <CourtDiagram zoomTo={cameraTarget} className="min-h-0 flex-1">
        {BUCKET_LABELS.map(({ bucket, label }, index) => (
          <ZoomedCard key={bucket} box={toCourtBox(cells[index]!)} gapClassName="p-[3px]">
            <Button
              variant="ghost"
              onClick={() => {
                onAction({ type: "TAP_RALLY_LENGTH", bucket });
              }}
              // Opaque, unlike the shot screen's cards: a card spanning the court's
              // lines would show them through a translucent white.
              className="h-full w-full flex-col gap-0 rounded-lg border-white/70 bg-[color-mix(in_oklch,var(--color-court)_8%,white)] p-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white"
            >
              {/* flex-1 rather than a fixed size, so the basket fills whatever room
                  the card actually has instead of guessing one number for every
                  aspect ratio the card can end up at. size-auto only exists to satisfy
                  Button's own `svg:not([class*='size-'])` rule, which would otherwise
                  force this down to a 16px icon the same way its Lucide icons are. */}
              <BasketIcon bucket={bucket} className="size-auto min-h-0 w-full flex-1" />
              <span className="flex-none text-sm font-semibold tabular-nums">{label}</span>
            </Button>
          </ZoomedCard>
        ))}
      </CourtDiagram>
    </div>
  );
}
