/**
 * The rally screen — how the point ended, and how long it ran.
 *
 * Two questions on one screen, answered in either order: whichever is tapped first is
 * recorded and stays selected, and the screen only moves on once both are in — see
 * capture-flow.ts's own RALLY case for the order-independent completion check.
 */

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CaptureAction } from "./capture-flow";
import {
  COURT_ACTIONS,
  COURT_COLUMNS,
  COURT_REGION_GRID,
  COURT_ROWS,
  CourtDiagram,
} from "./court-diagram";
import type { EndReason, RallyBucket } from "./point";
import { WinnerSheet } from "./winner-sheet";

// The four stored buckets, in the coach's own vocabulary. B1 is also what the flow
// fills in for an ace or a double fault, where there was no rally to ask about.
const BUCKET_LABELS: { bucket: RallyBucket; label: string }[] = [
  { bucket: "B1", label: "1-2" },
  { bucket: "B2", label: "3-5" },
  { bucket: "B3", label: "6-10" },
  { bucket: "B4", label: "11+" },
];

// Won or lost, by a ball that couldn't be reached or one that could. FORCED covers a
// clean winner as well as a forced error — the line is reachability (see point.ts).
const OUTCOMES: { won: boolean; endReason: "FORCED" | "MISTAKE"; kicker: string }[] = [
  { won: true, endReason: "FORCED", kicker: "Win" },
  { won: true, endReason: "MISTAKE", kicker: "Win" },
  { won: false, endReason: "FORCED", kicker: "Loss" },
  { won: false, endReason: "MISTAKE", kicker: "Loss" },
];

const CARD = "rounded-lg border border-white/70 shadow-[0_1px_6px_rgb(0_0_0/0.18)]";

export function RallyScreen({
  trackedPlayerName,
  opponentName,
  rallyBucket,
  onRallyBucketChange,
  won,
  endReason,
  onAction,
}: {
  rallyBucket: RallyBucket | null;
  onRallyBucketChange: (bucket: RallyBucket | null) => void;
  won: boolean | null;
  endReason: EndReason | null;
  onAction: (action: CaptureAction) => void;
  trackedPlayerName: string;
  opponentName: string;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  const outcomeChosen = won !== null && endReason !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Rally</h1>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status">
          {rallyBucket === null
            ? outcomeChosen
              ? "Pick the rally length"
              : "Pick the rally length and how it ended"
            : "Pick how it ended"}
        </p>
      </div>

      <CourtDiagram netLabel="Rally length" className="min-h-0 flex-1">
        {/* Both groups share one grid: two overlapping ones would each cover the other's
            cards, and a card sits in a court region rather than an even fraction. */}
        <div className="absolute inset-0 grid" style={COURT_REGION_GRID}>
          {OUTCOMES.map((outcome, index) => {
            const selected = won === outcome.won && endReason === outcome.endReason;
            return (
              <Button
                key={`${outcome.kicker}-${outcome.endReason}`}
                variant="ghost"
                aria-label={`${outcome.kicker}, ${outcome.endReason === "FORCED" ? "forced" : "unforced"} error`}
                aria-pressed={selected}
                onClick={() => {
                  onAction({
                    type: "TAP_RALLY_OUTCOME",
                    won: outcome.won,
                    endReason: outcome.endReason,
                  });
                }}
                style={{
                  gridColumn: COURT_COLUMNS[index % 2],
                  gridRow: COURT_ROWS[Math.floor(index / 2)],
                }}
                className={cn(
                  CARD,
                  "m-[3px] h-auto flex-col gap-1 px-1",
                  selected
                    ? "bg-primary hover:bg-primary/90"
                    : outcome.won
                      ? "bg-[color-mix(in_oklch,var(--color-court)_14%,rgb(255_255_255/0.92))] hover:bg-white/99"
                      : "bg-[color-mix(in_oklch,var(--destructive)_10%,rgb(255_255_255/0.92))] hover:bg-white/99",
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-semibold tracking-[0.1em] uppercase",
                    selected
                      ? "text-primary-foreground"
                      : outcome.won
                        ? "text-court"
                        : "text-destructive",
                  )}
                >
                  {outcome.kicker}
                </span>
                <span
                  className={cn(
                    "text-center text-sm leading-[1.2] font-semibold",
                    selected ? "text-primary-foreground" : "text-foreground",
                  )}
                >
                  {outcome.endReason === "FORCED" ? "Forced" : "Unforced"}
                  <br />
                  error
                </span>
              </Button>
            );
          })}

          {BUCKET_LABELS.map(({ bucket, label }, index) => {
            const selected = rallyBucket === bucket;
            return (
              <Button
                key={bucket}
                variant="ghost"
                aria-pressed={selected}
                // Sticky, not a toggle: one bucket always has to be chosen, so tapping
                // the chosen one again changes nothing rather than clearing it.
                onClick={() => {
                  onRallyBucketChange(bucket);
                }}
                style={{
                  gridColumn: COURT_COLUMNS[index % 2],
                  gridRow: COURT_ROWS[2 + Math.floor(index / 2)],
                }}
                className={cn(
                  CARD,
                  "m-[3px] h-auto px-1 text-base font-semibold tabular-nums",
                  selected
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-white/90 text-foreground hover:bg-white/99",
                )}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </CourtDiagram>

      <div className={COURT_ACTIONS}>
        <Button
          variant="outline"
          onClick={() => {
            onAction({ type: "TAP_UNUSUAL" });
          }}
          className="px-2 text-sm font-semibold"
        >
          Unusual end
        </Button>
        <Button
          variant="ghost"
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
        description="The rally length stays as recorded; how it ended is left unknown."
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
