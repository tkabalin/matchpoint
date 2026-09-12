/**
 * The final ball screen — where the last good ball finished, on either half of the court.
 *
 * The last good ball was hit by the winner and finished on the loser's half, whether it
 * bounced there untouched or the loser got a racket to it and missed. So one tap on a
 * full court records the zone and who won at once: the opponent's half means our player
 * won, ours means they lost. Four zones a half, deuce/ad by short/deep; a ball played
 * from behind the baseline or wide of the alley is tapped in the nearest zone.
 *
 * The opponent is always at the top and our player at the bottom, the way the serve and
 * return screens already draw it, and it never flips on a changeover. The model stores
 * no near/far, so which half is which is this screen's own convention.
 */

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CaptureAction } from "./capture-flow";
import { COURT_ACTIONS, CourtDiagram } from "./court-diagram";
import type { CourtDepth, CourtSide } from "./point";
import { WinnerSheet } from "./winner-sheet";

// Percentages follow court-diagram.tsx's own lines rather than the handoff, which drew
// two halves and no zones: baselines at 6.2% and 93.8%, service lines at 25.93% and
// 71.76%, the centre service line at 48.48%, net at 50%. Zones run line to line, so a
// tap near a line still lands somewhere.
const COLUMNS: { left: string; width: string }[] = [
  { left: "15.76%", width: "32.72%" },
  { left: "48.48%", width: "35.76%" },
];

const BANDS: Record<"far" | "near", Record<CourtDepth, { top: string; height: string }>> = {
  far: {
    DEEP: { top: "6.2%", height: "19.73%" },
    SHORT: { top: "25.93%", height: "24.07%" },
  },
  near: {
    SHORT: { top: "50%", height: "21.76%" },
    DEEP: { top: "71.76%", height: "22.04%" },
  },
};

// Deuce is to the right of the player standing on that half, so the far half reads
// deuce/ad left to right (as the serve screen's boxes do) and the near half ad/deuce (as
// the analytics heatmap draws our player's own court).
const HALVES: { end: "far" | "near"; won: boolean; sides: [CourtSide, CourtSide] }[] = [
  { end: "far", won: true, sides: ["DEUCE", "AD"] },
  { end: "near", won: false, sides: ["AD", "DEUCE"] },
];

const DEPTH_LABELS: Record<CourtDepth, string> = { SHORT: "short", DEEP: "deep" };
const HALF_LABELS: Record<CourtSide, string> = { DEUCE: "Deuce", AD: "Ad" };

export function FinalBallScreen({
  trackedPlayerName,
  opponentName,
  onAction,
}: {
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  const [pending, setPending] = useState(false);

  const zones = HALVES.flatMap(({ end, won, sides }) => {
    const owner = won ? opponentName : trackedPlayerName;
    return sides.flatMap((half, column) =>
      (["DEEP", "SHORT"] as const).map((depth) => {
        const label = `${HALF_LABELS[half]} ${DEPTH_LABELS[depth]}`;
        return {
          name: `${owner}: ${label.toLowerCase()}`,
          label,
          // The far deep labels sit low, clear of the name chip on that baseline; the
          // near ones stay centred, since "top" pads by a share of the width and in
          // landscape that pushes them into the chip instead of away from it.
          labelPlacement:
            depth === "DEEP" && end === "far" ? ("bottom" as const) : ("center" as const),
          box: { ...COLUMNS[column], ...BANDS[end][depth] },
          tone: "court" as const,
          onTap: () => {
            onAction({ type: "TAP_BALL_LOCATION", won, ballIn: true, location: { half, depth } });
          },
        };
      }),
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Final ball</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tap where the last good ball finished
        </p>
      </div>

      <CourtDiagram zones={zones} onPendingChange={setPending} className="min-h-0 flex-1">
        {/* Whose half is whose, chipped on each baseline so the coach never has to
            remember the convention mid-match. Same chip as the shot screen's wing labels. */}
        {HALVES.map(({ end, won }) => (
          <span
            key={end}
            className={cn(
              "pointer-events-none absolute left-1/2 z-30 flex h-5 -translate-x-1/2 items-center rounded-md bg-white/95 px-3 text-[11px] font-semibold tracking-[0.08em] text-chart-5 uppercase shadow-[0_1px_6px_rgb(0_0_0/0.2)]",
              end === "far" ? "top-[1.5%]" : "bottom-[1.5%]",
            )}
          >
            {won ? opponentName : trackedPlayerName}
          </span>
        ))}
      </CourtDiagram>

      <div className={COURT_ACTIONS}>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            onAction({ type: "TAP_UNUSUAL" });
          }}
          className="px-2 text-sm font-semibold"
        >
          Unusual end
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            onAction({ type: "TAP_LET" });
          }}
          className="gap-1.5 border-primary/30 bg-primary/10 px-2 text-sm font-semibold text-primary hover:bg-primary/20"
        >
          <RotateCcw className="size-5" />
          Let
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setAskingWinner(true);
          }}
          className="px-2 text-sm font-semibold text-muted-foreground"
        >
          Didn&apos;t see
        </Button>
      </div>

      <WinnerSheet
        open={askingWinner}
        description="How the point ended is left unknown."
        trackedPlayerName={trackedPlayerName}
        opponentName={opponentName}
        onPick={(won) => {
          setAskingWinner(false);
          onAction({ type: "TAP_DIDNT_SEE", won });
        }}
        onOpenChange={setAskingWinner}
      />
    </div>
  );
}
