/**
 * The serve screen — the tracked player's own serve, one tap per attempt.
 *
 * Which service box the serve had to land in is `draft.courtSide`, so the live box is
 * the only "in" target and everything else on the court is a fault carrying the mode
 * its zone stands for. Placement inside the box is not captured (see point.ts's
 * comment on ServeAttempt.location). The opponent's serve is the return screen's job.
 */

import { RotateCcw, Zap } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { CaptureAction, CaptureStep, PointDraft } from "./capture-flow";
import { CourtDiagram } from "./court-diagram";
import type { CourtBox, CourtTapZone } from "./court-diagram";
import type { CourtSide, FailureMode, ServeAttempt } from "./point";

// Percentages copied verbatim from the design handoff, as in court-diagram.tsx.
const SERVICE_BOXES: Record<CourtSide, CourtBox> = {
  DEUCE: { left: "18.79%", top: "22%", width: "29.7%", height: "20%" },
  AD: { left: "48.48%", top: "22%", width: "32.73%", height: "20%" },
};

// The strip between the service line and the baseline, one per side: a serve landing
// there cleared the box it was aimed at, which is long.
const BEHIND_SERVICE_LINE: Record<CourtSide, CourtBox> = {
  DEUCE: { left: "18.79%", top: "6.2%", width: "29.7%", height: "15.8%" },
  AD: { left: "48.48%", top: "6.2%", width: "32.73%", height: "15.8%" },
};

const BOX_LABELS: Record<CourtSide, string> = { DEUCE: "Deuce", AD: "Ad" };

function otherSide(side: CourtSide): CourtSide {
  return side === "DEUCE" ? "AD" : "DEUCE";
}

// How the status line names the fault the coach just tapped. Only meaningful on a
// faulted attempt: "WIDE" is a ServeTarget as well as a FailureMode.
function faultReason(location: ServeAttempt["location"]): string {
  if (location === "LONG") return "long";
  if (location === "NET") return "into net";
  return "wide";
}

export function ServeScreen({
  step,
  draft,
  onAction,
}: {
  step: Extract<CaptureStep, { name: "SERVE" }>;
  draft: PointDraft;
  onAction: (action: CaptureAction) => void;
}) {
  // A let leaves the flow exactly where it was, so the only thing to show for it is a
  // message this screen owns; every other tap moves the step and re-derives the line.
  const [letNotice, setLetNotice] = useState<string | null>(null);

  function fault(location: FailureMode) {
    return () => {
      setLetNotice(null);
      onAction({ type: "TAP_SERVE_FAULT", location });
    };
  }

  const live = draft.courtSide;
  const wrongBox = otherSide(live);

  const zones: CourtTapZone[] = [
    {
      name: "Long",
      box: { left: "0", right: "0", top: "0", height: "6.2%" },
      tone: "out",
      label: "Long",
      onTap: fault("LONG"),
    },
    {
      name: `Long (${BOX_LABELS.DEUCE.toLowerCase()} side)`,
      box: BEHIND_SERVICE_LINE.DEUCE,
      tone: "out",
      onTap: fault("LONG"),
    },
    {
      name: `Long (${BOX_LABELS.AD.toLowerCase()} side)`,
      box: BEHIND_SERVICE_LINE.AD,
      tone: "out",
      onTap: fault("LONG"),
    },
    {
      name: `${BOX_LABELS[live]} service box`,
      box: SERVICE_BOXES[live],
      tone: "in",
      label: BOX_LABELS[live],
      labelPlacement: "bottom",
      onTap: () => {
        setLetNotice(null);
        onAction({ type: "TAP_SERVE_IN" });
      },
    },
    {
      // The box this point isn't played into: reaching it means the serve crossed the
      // centre service line, which is out to the side.
      name: `${BOX_LABELS[wrongBox]} service box`,
      box: SERVICE_BOXES[wrongBox],
      tone: "out",
      label: BOX_LABELS[wrongBox],
      labelPlacement: "bottom",
      onTap: fault("WIDE"),
    },
    {
      name: "Wide (left)",
      box: { left: "0", top: "6.2%", width: "18.79%", height: "35.8%" },
      tone: "out",
      onTap: fault("WIDE"),
    },
    {
      name: "Wide (right)",
      box: { left: "81.21%", top: "6.2%", width: "18.79%", height: "35.8%" },
      tone: "out",
      onTap: fault("WIDE"),
    },
    {
      name: "Net",
      box: { left: "0", right: "0", top: "42%", height: "18%" },
      tone: "out",
      onTap: fault("NET"),
    },
  ];

  const firstServe = step.number === 2 ? draft.serves[0] : undefined;
  const faultLine =
    firstServe?.outcome === "FAULT"
      ? `Fault — ${faultReason(firstServe.location)}. Second serve.`
      : null;
  const status = letNotice ?? faultLine ?? "Tap where the serve landed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">
            {step.number === 1 ? "1st Serve" : "2nd Serve"}
          </h1>
          <Badge variant="ghost" className="bg-accent text-primary">
            {live === "DEUCE" ? "Deuce court" : "Ad court"}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <CourtDiagram zones={zones} netLabel="Net" className="min-h-0 flex-1" />
        <p className="mt-2.5 px-0.5 text-center text-xs text-muted-foreground">
          Outer zones and the net are out
        </p>
      </div>

      <div className="flex flex-none items-end justify-between pt-4">
        <Button
          variant="ghost"
          onClick={() => {
            setLetNotice(null);
            onAction({ type: "TAP_SERVE_ACE" });
          }}
          className="h-11 gap-2 border-court/30 bg-court/10 px-[18px] text-base font-semibold text-court hover:bg-court/20"
        >
          <Zap className="size-5" />
          Ace
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setLetNotice("Let — replay the point.");
            onAction({ type: "TAP_LET" });
          }}
          className="h-11 gap-2 border-primary/30 bg-primary/10 px-[18px] text-base font-semibold text-primary hover:bg-primary/20"
        >
          <RotateCcw className="size-5" />
          Let
        </Button>
      </div>
    </div>
  );
}
