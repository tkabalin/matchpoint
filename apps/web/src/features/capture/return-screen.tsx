/**
 * The return screen — the opponent's serve, seen from our player's return of it.
 *
 * Only the safe area counts as in: the serve itself is never placed (point.ts keeps
 * opponent serve placement out of scope), so a court tap says where our player's
 * return went, not where the serve landed. A return that missed needs the coach's
 * forced/mistake read as well as its placement, which is the one thing a single tap
 * can't carry — hence the follow-up.
 */

import { BicepsFlexed, CircleX, RotateCcw, Spade } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UnforcedIcon } from "@/components/unforced-icon";

import type { CaptureAction, CaptureStep } from "./capture-flow";
import { COURT_ACTIONS, CourtDiagram } from "./court-diagram";
import type { CourtTapZone } from "./court-diagram";
import type { FailureMode } from "./point";

// No draft is needed here, unlike the serve screen: nothing on this screen depends on
// the court side, and the second-serve line comes from the step alone.
export function ReturnScreen({
  step,
  onAction,
}: {
  step: Extract<CaptureStep, { name: "SERVE" }>;
  onAction: (action: CaptureAction) => void;
}) {
  // Where the return missed, held while the coach says whether it was forced. Null
  // whenever no follow-up is pending.
  const [missedTo, setMissedTo] = useState<FailureMode | null>(null);
  const [letNotice, setLetNotice] = useState<string | null>(null);
  // Ace/Fault/Let sit outside the court, so they're not covered by CourtDiagram's own
  // zone-vs-zone tap guard — disable them while a zone tap's flash is pending, or one
  // fires immediately and the queued zone tap lands later against stale state.
  const [pending, setPending] = useState(false);

  function miss(location: FailureMode) {
    return () => {
      setLetNotice(null);
      setMissedTo(location);
    };
  }

  function recordMiss(endReason: "FORCED" | "MISTAKE") {
    if (missedTo === null) return;
    onAction({ type: "TAP_RETURN", outcome: missedTo, endReason });
    setMissedTo(null);
  }

  const zones: CourtTapZone[] = [
    {
      name: "Long",
      box: { left: "0", right: "0", top: "0", height: "6.2%" },
      tone: "out",
      label: "Long",
      onTap: miss("LONG"),
    },
    {
      name: "Safe area",
      box: { left: "18.79%", right: "18.79%", top: "6.2%", height: "35.8%" },
      tone: "in",
      label: "Safe area — in",
      labelPlacement: "top",
      onTap: () => {
        setLetNotice(null);
        onAction({ type: "TAP_RETURN", outcome: "IN" });
      },
    },
    {
      name: "Wide (left)",
      box: { left: "0", top: "6.2%", width: "18.79%", height: "35.8%" },
      tone: "out",
      label: "Wide",
      labelPlacement: "top",
      labelOrientation: "vertical-up",
      onTap: miss("WIDE"),
    },
    {
      name: "Wide (right)",
      box: { left: "81.21%", top: "6.2%", width: "18.79%", height: "35.8%" },
      tone: "out",
      label: "Wide",
      labelPlacement: "top",
      labelOrientation: "vertical-down",
      onTap: miss("WIDE"),
    },
    {
      name: "Net",
      box: { left: "0", right: "0", top: "42%", height: "18%" },
      tone: "out",
      onTap: miss("NET"),
    },
  ];

  // The opponent's fault carries no placement, so unlike the serve screen there is no
  // reason to name — only that a second serve is coming.
  const faultLine = step.number === 2 ? "Fault. Second serve." : null;
  const status = letNotice ?? faultLine ?? "Tap where the return landed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-0.5 pt-[22px] pb-[14px]">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Return</h1>
          <Badge variant="ghost" className="bg-accent text-primary">
            Only safe area
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status">
          {status}
        </p>
      </div>

      <CourtDiagram
        zones={zones}
        netLabel="Net"
        className="min-h-0 flex-1"
        onPendingChange={setPending}
      />

      <div className={COURT_ACTIONS}>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setLetNotice(null);
            onAction({ type: "TAP_SERVE_ACE" });
          }}
          className="gap-1.5 border-court/30 bg-court/10 px-2 text-sm font-semibold text-court hover:bg-court/20"
        >
          <Spade className="size-5" />
          Ace
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setLetNotice(null);
            onAction({ type: "TAP_SERVE_FAULT" });
          }}
          className="gap-1.5 px-2 text-sm font-semibold"
        >
          <CircleX className="size-5" />
          Fault
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setLetNotice("Let — replay the point.");
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
            setLetNotice(null);
            onAction({ type: "TAP_DIDNT_SEE" });
          }}
          className="px-2 text-sm font-semibold text-muted-foreground"
        >
          Didn&apos;t see
        </Button>
      </div>

      <Sheet
        open={missedTo !== null}
        onOpenChange={(open) => {
          if (!open) setMissedTo(null);
        }}
      >
        <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
          <SheetHeader className="p-0">
            <SheetTitle>Was the return forced?</SheetTitle>
          </SheetHeader>
          <p className="text-sm text-muted-foreground">
            The line is reachability, not whether the racket touched it.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                recordMiss("FORCED");
              }}
              className="h-[76px] flex-col gap-1"
            >
              <span className="flex items-center gap-1.5 text-base font-semibold text-outcome-forced">
                <BicepsFlexed className="size-4" />
                Forced
              </span>
              <span className="text-xs text-muted-foreground">The serve was too good</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                recordMiss("MISTAKE");
              }}
              className="h-[76px] flex-col gap-1"
            >
              <span className="flex items-center gap-1.5 text-base font-semibold text-outcome-unforced">
                <UnforcedIcon className="size-4" />
                Unforced
              </span>
              <span className="text-xs text-muted-foreground">A returnable ball missed</span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
