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
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import type { CaptureAction } from "./capture-flow";
import { COURT_ACTIONS, CourtDiagram, CourtPlayerLabels } from "./court-diagram";
import { finalBallZoneRegion, toCourtBox } from "./court-geometry";
import type { CourtDepth, CourtSide } from "./point";
import { WinnerSheet } from "./winner-sheet";

// Deuce is to the right of the player standing on that half, so the far half reads
// deuce/ad left to right (as the serve screen's boxes do) and the near half ad/deuce (as
// the analytics heatmap draws our player's own court).
const HALVES: { won: boolean; sides: [CourtSide, CourtSide] }[] = [
  { won: true, sides: ["DEUCE", "AD"] },
  { won: false, sides: ["AD", "DEUCE"] },
];

const DEPTH_LABELS: Record<CourtDepth, string> = { SHORT: "short", DEEP: "deep" };
const HALF_LABELS: Record<CourtSide, string> = { DEUCE: "Deuce", AD: "Ad" };

export function FinalBallScreen({
  trackedPlayerName,
  opponentName,
  onAction,
  syncStatus,
}: {
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
  // Sits at the right of the heading row, wrapping rather than pushing into the title.
  syncStatus?: ReactNode;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  const [pending, setPending] = useState(false);

  const zones = HALVES.flatMap(({ won, sides }) => {
    const owner = won ? opponentName : trackedPlayerName;
    return sides.flatMap((half) =>
      (["DEEP", "SHORT"] as const).map((depth) => {
        const label = `${HALF_LABELS[half]} ${DEPTH_LABELS[depth]}`;
        return {
          // No `label` painted on the zone itself — a coach knows the four quadrants by
          // feel, so the text only added clutter — but the accessible name keeps the
          // same "deuce/ad deep/short" text, for tests and screen readers alike.
          name: `${owner}: ${label.toLowerCase()}`,
          box: toCourtBox(finalBallZoneRegion(won, { half, depth })),
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
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-3xl font-semibold tracking-[-0.02em]">Final ball</h1>
          {syncStatus}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tap where the last good ball finished
        </p>
      </div>

      <CourtDiagram zones={zones} onPendingChange={setPending} className="min-h-0 flex-1">
        <CourtPlayerLabels trackedPlayerName={trackedPlayerName} opponentName={opponentName} />
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
            setAskingWinner(true);
          }}
          className="px-2 text-sm font-semibold text-muted-foreground"
        >
          Didn&apos;t see
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
