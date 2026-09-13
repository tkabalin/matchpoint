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
 * top, so the button grid can't overlap it. Each shot's icon, and each wing's own
 * caption icon, are the same ones the Rally tab's shot-type and wing breakdowns use
 * (see `.claude/rules/web-icons.md`), so a coach who knows one screen recognises the
 * shape on the other. Whose shot it was is never tapped — a Point derives that from
 * `won` (see lastShotPlayer).
 */

import {
  ArrowBigLeftDash,
  ArrowBigRightDash,
  ChevronDown,
  ChevronUp,
  Rainbow,
  TrendingUp,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { COURT_ACTIONS, CourtDiagram, ZoomedCard } from "./court-diagram";
import { subCells, toCourtBox, zoomScale } from "./court-geometry";
import type { ShotType, Wing } from "./point";

// Rows, in the order the design lays them out. Smash and slice are deliberately absent
// from the model (see point.ts), so four rows covers every stored type. Icons match the
// Rally tab's own shot-type breakdown (`.claude/rules/web-icons.md`) rather than being
// picked fresh for this screen.
const SHOTS: {
  shotType: ShotType;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { shotType: "DRIVE", label: "Drive", Icon: TrendingUp },
  { shotType: "VOLLEY", label: "Volley", Icon: ChevronUp },
  { shotType: "DROPSHOT", label: "Drop shot", Icon: ChevronDown },
  { shotType: "LOB", label: "Lob", Icon: Rainbow },
];

// Columns. Backhand on the left, matching the handoff. Icons are the Rally tab's own
// wing icons (`.claude/rules/web-icons.md`), not picked fresh for this screen.
const WINGS: {
  wing: Wing;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { wing: "BACKHAND", label: "Backhand", Icon: ArrowBigLeftDash },
  { wing: "FOREHAND", label: "Forehand", Icon: ArrowBigRightDash },
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
          {/* gap-2 keeps the two labels from running into one word ("BACKHANDFOREHAND")
              when the region is squeezed narrow (a short viewport in landscape);
              overflow-hidden + truncate on the label is the same guard rather than
              letting a long word push the icon out or spill into the other column. */}
          <div className="flex h-full w-full items-center gap-2">
            {WINGS.map((wing) => (
              <div
                key={wing.wing}
                className="flex flex-1 items-center justify-center gap-1 overflow-hidden"
              >
                <wing.Icon
                  className="size-4 shrink-0 text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.35))]"
                  aria-hidden="true"
                />
                <span className="truncate text-center text-base font-bold tracking-[0.04em] text-white uppercase [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">
                  {wing.label}
                </span>
              </div>
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
                // overflow-hidden: eight cards this small (a short viewport in
                // landscape leaves each one only a few px tall) can end up smaller than
                // the icon-plus-label's own natural size — without this the label spills
                // past the card's own edge into the next one instead of just clipping.
                className="h-full w-full gap-1 overflow-hidden rounded-lg border-white/70 bg-white/90 text-center text-sm font-semibold whitespace-normal text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white/99"
              >
                <shot.Icon className="size-3.5 shrink-0" aria-hidden="true" />
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
