/**
 * The ending screen — forced or unforced.
 *
 * Who won is already known from the final ball, so this is one question on two cards,
 * side by side inside the region the final ball zoomed into (reached after rally length,
 * so no entrance animation of its own — see rally-length-screen.tsx). FORCED covers a
 * clean winner as well as a forced error — the line is reachability (see point.ts). The
 * subtitle names the winner so a half tapped by mistake is caught here, one undo away,
 * rather than after the point has scored.
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import type { CourtRegion } from "./court-diagram";
import { CourtDiagram } from "./court-diagram";
import { subCells, toCourtBox, zoomScale } from "./court-geometry";

const ENDINGS: { endReason: "FORCED" | "MISTAKE"; label: string }[] = [
  { endReason: "FORCED", label: "Forced" },
  { endReason: "MISTAKE", label: "Unforced" },
];

export function EndingScreen({
  won,
  zoomTo,
  trackedPlayerName,
  opponentName,
  onAction,
}: {
  won: boolean;
  /** The region the final ball landed in — see court-geometry.ts's own comment. */
  zoomTo: CourtRegion;
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
}) {
  const winner = won ? trackedPlayerName : opponentName;
  const loser = won ? opponentName : trackedPlayerName;
  // subCells(zoomTo, 1, 2) always returns exactly 2 regions, one per ending below.
  const cells = subCells(zoomTo, 1, 2);
  // A card's text would come out `scale` times too big once the court's own zoom
  // transform enlarges it along with everything else — see court-diagram.tsx's own
  // comment on zoomScale.
  const scale = zoomScale(zoomTo);
  const labelSize = 20 / scale;
  const descriptionSize = 12 / scale;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">How it ended</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Point to {winner}</p>
      </div>

      <CourtDiagram zoomTo={zoomTo} className="min-h-0 flex-1">
        {ENDINGS.map(({ endReason, label }, index) => (
          <Button
            key={endReason}
            variant="ghost"
            onClick={() => {
              onAction({ type: "TAP_ENDING", endReason });
            }}
            style={{ ...toCourtBox(cells[index]!), gap: `${String(4 / scale)}px` }}
            // Opaque, unlike the shot screen's cards: a card spanning the court's lines
            // would show them through a translucent white.
            className="absolute flex-col m-[3px] rounded-lg border-white/70 bg-[color-mix(in_oklch,var(--color-court)_8%,white)] px-1 whitespace-normal shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white"
          >
            <span
              style={{ fontSize: `${String(labelSize)}px` }}
              className="font-semibold text-foreground"
            >
              {label}
            </span>
            <span
              style={{ fontSize: `${String(descriptionSize)}px` }}
              className="text-center font-medium text-muted-foreground"
            >
              {endReason === "FORCED"
                ? `Winner, or ${loser} couldn't reach it`
                : `${loser}'s mistake`}
            </span>
          </Button>
        ))}
      </CourtDiagram>
    </div>
  );
}
