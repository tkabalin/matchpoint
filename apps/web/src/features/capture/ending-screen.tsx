/**
 * The ending screen — forced or unforced.
 *
 * Who won is already known from the final ball, so this is one question on two cards.
 * FORCED covers a clean winner as well as a forced error — the line is reachability (see
 * point.ts). The subtitle names the winner so a half tapped by mistake is caught here,
 * one undo away, rather than after the point has scored.
 */

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import { CourtDiagram } from "./court-diagram";
import { COURT_HALF_COLUMNS, COURT_HALF_ROWS, COURT_REGION_GRID } from "./court-regions";

const ENDINGS: { endReason: "FORCED" | "MISTAKE"; label: string }[] = [
  { endReason: "FORCED", label: "Forced" },
  { endReason: "MISTAKE", label: "Unforced" },
];

export function EndingScreen({
  won,
  trackedPlayerName,
  opponentName,
  onAction,
}: {
  won: boolean;
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
}) {
  const winner = won ? trackedPlayerName : opponentName;
  const loser = won ? opponentName : trackedPlayerName;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">How it ended</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Point to {winner}</p>
      </div>

      <CourtDiagram className="min-h-0 flex-1">
        {/* One card per half of the court, spanning both columns and the backcourt and
            service box together. */}
        <div className="absolute inset-0 grid" style={COURT_REGION_GRID}>
          {ENDINGS.map(({ endReason, label }, index) => (
            <Button
              key={endReason}
              variant="ghost"
              onClick={() => {
                onAction({ type: "TAP_ENDING", endReason });
              }}
              style={{
                gridColumn: COURT_HALF_COLUMNS,
                gridRow: index === 0 ? COURT_HALF_ROWS.far : COURT_HALF_ROWS.near,
              }}
              // Opaque, unlike the shot screen's cards: a card spanning the court's lines
              // would show them through a translucent white.
              className="m-[3px] h-auto flex-col gap-1 rounded-lg border-white/70 bg-[color-mix(in_oklch,var(--color-court)_8%,white)] px-1 whitespace-normal shadow-[0_1px_6px_rgb(0_0_0/0.18)] hover:bg-white"
            >
              <span className="text-xl font-semibold text-foreground">{label}</span>
              <span className="text-center text-xs font-medium text-muted-foreground">
                {endReason === "FORCED"
                  ? `Winner, or ${loser} couldn't reach it`
                  : `${loser}'s mistake`}
              </span>
            </Button>
          ))}
        </div>
      </CourtDiagram>
    </div>
  );
}
