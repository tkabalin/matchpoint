/**
 * The unusual point end sheet — the point that left normal play.
 *
 * Two questions, one sheet, but not two pieces of local state: the flow already has a
 * step for each (UNUSUAL_OUTCOME then UNUSUAL_REASON), so which half shows is read from
 * the step, and Back is the flow's own UNDO rather than a second history to keep.
 *
 * Who won is mandatory — the score has to stay right whatever happened. The reason is
 * optional to the model, but this sheet asks for it anyway, since OTHER covers whatever
 * isn't listed and a point skipped outright takes the header's own path instead.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { CaptureAction, CaptureStep } from "./capture-flow";
import { UNUSUAL_REASONS } from "./point";
import type { UnusualReason } from "./point";

const REASON_LABELS: Record<UnusualReason, string> = {
  NET_TOUCH: "Touched the net",
  BALL_HIT_PLAYER: "Ball hit a player",
  REACHED_OVER: "Reached over the net",
  DOUBLE_HIT: "Double hit",
  HINDRANCE: "Hindrance",
  POINT_PENALTY: "Point penalty",
  OTHER: "Other",
};

const KICKER = "text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export function UnusualPointSheet({
  step,
  trackedPlayerName,
  opponentName,
  onAction,
  onDismiss,
}: {
  step: Extract<CaptureStep, { name: "UNUSUAL_OUTCOME" } | { name: "UNUSUAL_REASON" }>;
  trackedPlayerName: string;
  opponentName: string;
  onAction: (action: CaptureAction) => void;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState<UnusualReason | null>(null);
  const askingWinner = step.name === "UNUSUAL_OUTCOME";

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Unusual point end</SheetTitle>
          <SheetDescription>
            {askingWinner
              ? "The point ended outside normal play. Who won it?"
              : "What happened? Other covers anything not listed."}
          </SheetDescription>
        </SheetHeader>

        {askingWinner ? (
          <div className="flex flex-col gap-2">
            <div className={KICKER}>Who won the point?</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  onAction({ type: "TAP_UNUSUAL_OUTCOME", won: true });
                }}
                className="h-[76px] flex-col gap-1 border-court/30 bg-court/10 hover:bg-court/20"
              >
                <span className="text-base font-semibold text-court">Win</span>
                <span className="text-xs text-muted-foreground">Point to {trackedPlayerName}</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onAction({ type: "TAP_UNUSUAL_OUTCOME", won: false });
                }}
                className="h-[76px] flex-col gap-1 border-destructive/30 bg-destructive/10 hover:bg-destructive/20"
              >
                <span className="text-base font-semibold text-destructive">Loss</span>
                <span className="text-xs text-muted-foreground">Point to {opponentName}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className={KICKER}>Reason</div>
            <div role="radiogroup" aria-label="Reason" className="flex flex-col gap-1.5">
              {UNUSUAL_REASONS.map((option) => {
                const selected = reason === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setReason(option);
                    }}
                    className={cn(
                      "flex min-h-12 items-center justify-between gap-3 rounded-sm border px-3.5 py-[11px] text-left transition-colors",
                      selected ? "border-primary bg-accent" : "border-border hover:bg-muted",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-medium">{REASON_LABELS[option]}</span>
                      {/* The stored code, shown so a coach and the data agree on what
                          was recorded — the handoff asks for it explicitly. */}
                      <span className="block text-[10px] tracking-[0.06em] text-muted-foreground tabular-nums">
                        {option}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 rounded-full border",
                        selected ? "border-primary bg-primary" : "border-border",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (askingWinner) {
                onDismiss();
              } else {
                onAction({ type: "UNDO" });
              }
            }}
            className="h-14 text-base"
          >
            {askingWinner ? "Cancel" : "Back"}
          </Button>
          <Button
            disabled={askingWinner || reason === null}
            onClick={() => {
              if (reason === null) return;
              onAction({ type: "TAP_UNUSUAL_REASON", reason, note: null });
            }}
            className="h-14 text-base"
          >
            Record point
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
