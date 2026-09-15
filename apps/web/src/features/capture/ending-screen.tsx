/**
 * The ending screen — forced or unforced.
 *
 * Who won is already known from the final ball, so this is one question on two cards,
 * side by side inside the region the final ball zoomed into (reached after rally length,
 * so no entrance animation of its own — see rally-length-screen.tsx). FORCED covers a
 * clean winner as well as a forced error — the line is reachability (see point.ts). The
 * subtitle names the winner so a half tapped by mistake is caught here, one undo away,
 * rather than after the point has scored.
 *
 * Each card leads with the same forced/unforced symbol the Rally tab and the return
 * screen's own forced/unforced sheet use (a flexed arm, a thumbs down — see
 * .claude/rules/web-icons.md), so the two ideas look the same everywhere they appear.
 */

import { BicepsFlexed, ThumbsDown } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { CourtDiagram, ZoomedCard } from "./court-diagram";
import { subCells, toCourtBox } from "./court-geometry";

const ENDINGS: {
  endReason: "FORCED" | "MISTAKE";
  label: string;
  Icon: typeof BicepsFlexed;
  colorClass: string;
}[] = [
  {
    endReason: "FORCED",
    label: "Forced",
    Icon: BicepsFlexed,
    colorClass: "text-outcome-forced",
  },
  {
    endReason: "MISTAKE",
    label: "Unforced",
    Icon: ThumbsDown,
    colorClass: "text-outcome-unforced",
  },
];

export function EndingScreen({
  won,
  zoomTo,
  trackedPlayerName,
  opponentName,
  onAction,
  syncStatus,
}: {
  won: boolean;
  /** The region the final ball landed in — see court-geometry.ts's own comment. */
  zoomTo: CourtRegion;
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
  // Sits at the right of the heading row, wrapping rather than pushing into the title.
  syncStatus?: ReactNode;
}) {
  const winner = won ? trackedPlayerName : opponentName;
  const loser = won ? opponentName : trackedPlayerName;
  // subCells(zoomTo, 1, 2) always returns exactly 2 regions, one per ending below.
  const cells = subCells(zoomTo, 1, 2);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-3xl font-semibold tracking-[-0.02em]">How it ended</h1>
          {syncStatus}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">Point to {winner}</p>
      </div>

      <CourtDiagram zoomTo={zoomTo} className="min-h-0 flex-1">
        {ENDINGS.map(({ endReason, label, Icon, colorClass }, index) => (
          <ZoomedCard key={endReason} box={toCourtBox(cells[index]!)} gapClassName="p-[3px]">
            <Button
              variant="ghost"
              onClick={() => {
                onAction({ type: "TAP_ENDING", endReason });
              }}
              // Opaque, unlike the shot screen's cards: a card spanning the court's
              // lines would show them through a translucent white.
              className="h-full w-full flex-col gap-1 rounded-lg border-white/70 bg-[color-mix(in_oklch,var(--color-court)_8%,white)] p-2 whitespace-normal shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white"
            >
              {/* size-auto opts out of Button's own `svg:not([class*='size-'])` rule
                  (see basket-icon.tsx's own note on this), so flex-1 can size it. */}
              <Icon className={cn("size-auto min-h-0 w-full flex-1", colorClass)} />
              <span className={cn("flex-none text-xl font-semibold", colorClass)}>{label}</span>
              <span className="flex-none text-center text-xs font-medium text-muted-foreground">
                {endReason === "FORCED"
                  ? `Winner, or ${loser} couldn't reach it`
                  : `${loser}'s mistake`}
              </span>
            </Button>
          </ZoomedCard>
        ))}
      </CourtDiagram>
    </div>
  );
}
