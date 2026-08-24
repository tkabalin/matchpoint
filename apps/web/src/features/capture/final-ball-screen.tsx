/**
 * The final ball screen — where the last ball to land finished.
 *
 * Four zones, deuce/ad by short/deep, the split players asked for. On an unforced
 * error that ball is the one before the miss (see Point.ballLocation), so the screen is
 * the same whatever ended the point and `ballIn` is always true.
 *
 * Which half of the net the zones sit in is derived, never tapped: a ball our player
 * hit lands in the opponent's half and vice versa, and `won` already says who hit the
 * last one that landed. The model stores no near/far, so this is presentation only —
 * it just has to match where the coach watched the ball bounce.
 */

import type { CaptureAction } from "./capture-flow";
import { CourtDiagram } from "./court-diagram";
import type { CourtDepth, CourtSide } from "./point";

// Percentages follow court-diagram.tsx's own lines rather than the handoff, which drew
// two halves and no zones: baselines at 6.2% and 93.8%, service lines at 25.93% and
// 71.76%, the centre service line at 48.48%, net at 50%. Zones run line to line, so a
// tap near a line still lands somewhere.
const COLUMNS: { half: CourtSide; left: string; width: string }[] = [
  { half: "DEUCE", left: "15.76%", width: "32.72%" },
  { half: "AD", left: "48.48%", width: "35.76%" },
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

const DEPTH_LABELS: Record<CourtDepth, string> = { SHORT: "short", DEEP: "deep" };
const HALF_LABELS: Record<CourtSide, string> = { DEUCE: "Deuce", AD: "Ad" };

export function FinalBallScreen({
  won,
  onAction,
}: {
  // Whoever won hit the last ball that landed, so this is also which half it landed in.
  won: boolean;
  onAction: (action: CaptureAction) => void;
}) {
  const bands = BANDS[won ? "far" : "near"];
  const zones = COLUMNS.flatMap((column) =>
    (["DEEP", "SHORT"] as const).map((depth) => {
      const label = `${HALF_LABELS[column.half]} ${DEPTH_LABELS[depth]}`;
      return {
        name: label,
        label,
        box: { left: column.left, width: column.width, ...bands[depth] },
        tone: "court" as const,
        onTap: () => {
          onAction({
            type: "TAP_BALL_LOCATION",
            ballIn: true,
            location: { half: column.half, depth },
          });
        },
      };
    }),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Final ball</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tap where the last ball to land finished
        </p>
      </div>

      <CourtDiagram zones={zones} className="min-h-0 flex-1" />
    </div>
  );
}
