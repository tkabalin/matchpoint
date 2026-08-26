/**
 * The skip ahead sheet — resume capture from a score already on the scoreboard, or end
 * the match outright.
 *
 * Court side isn't asked for, unlike the handoff: deuce or ad follows from how many
 * points the current game has had (see nextCourtSideFor), so a chip here would be
 * overruled by the score entered two fields above it. Serving next is still asked
 * even though it can only be honoured before any real point exists — see
 * skipAhead's own comment on reseeding.
 *
 * Ending the match asks who won as well as why. A retirement's winner is the player who
 * didn't retire, and a walkover or default has no score to read one off at all, so
 * Match.outcomeOverride can't be filled without it.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { MATCH_END_REASONS } from "./match";
import type { Match, MatchEndReason } from "./match";
import type { Point } from "./point";
import { POINT_CALLS, skipAhead, validateTarget } from "./skip-ahead";
import type { PointCall, SkipAheadTarget } from "./skip-ahead";

// Only used to probe whether skipAhead would throw for the score currently typed in
// — never committed, so the exact id doesn't matter, just that repeats within one
// probe stay distinct.
let previewIdCounter = 0;
const previewId = () => `skip-ahead-preview-${String((previewIdCounter += 1))}`;

const END_REASON_COPY: Record<MatchEndReason, { label: string; description: string }> = {
  retirement: {
    label: "Retirement",
    description: "A player stopped mid-match, usually injured.",
  },
  walkover: {
    label: "Walkover",
    description: "A player never took the court.",
  },
  default: {
    label: "Default",
    description: "A player was disqualified by the official.",
  },
};

const KICKER = "text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: boolean }[];
  // Null shows neither as chosen, for a question that has no sensible default.
  value: boolean | null;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className={KICKER}>{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <Button
            key={option.label}
            variant={value === option.value ? "default" : "outline"}
            aria-pressed={value === option.value}
            onClick={() => {
              onChange(option.value);
            }}
            className="h-11 text-sm"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function SkipAheadSheet({
  match,
  points,
  trackedPlayerName,
  opponentName,
  onSkipToScore,
  onEndMatch,
  onDismiss,
}: {
  match: Match;
  points: readonly Point[];
  trackedPlayerName: string;
  opponentName: string;
  onSkipToScore: (target: SkipAheadTarget) => void;
  onEndMatch: (outcome: { reason: MatchEndReason; trackedPlayerWon: boolean }) => void;
  onDismiss: () => void;
}) {
  const [trackedGames, setTrackedGames] = useState("0");
  const [opponentGames, setOpponentGames] = useState("0");
  const [trackedPoints, setTrackedPoints] = useState<PointCall>("0");
  const [opponentPoints, setOpponentPoints] = useState<PointCall>("0");
  const [trackedServesNext, setTrackedServesNext] = useState(true);

  const [endingMatch, setEndingMatch] = useState(false);
  const [endReason, setEndReason] = useState<MatchEndReason | null>(null);
  const [trackedPlayerWon, setTrackedPlayerWon] = useState<boolean | null>(null);

  const target: SkipAheadTarget = {
    trackedGames: Number(trackedGames),
    opponentGames: Number(opponentGames),
    trackedPoints,
    opponentPoints,
    trackedServesNext,
  };
  // validateTarget only checks the target's own shape; skipAhead can still refuse it
  // once it's weighed against the real points already recorded (behind the real
  // score, or a "serving next" answer the real rotation disagrees with) — probing it
  // here surfaces that inline, the same way, rather than as an error on tap.
  const problem =
    validateTarget(target) ??
    (() => {
      try {
        skipAhead(match, points, target, previewId, 0);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "That score can't be reached";
      }
    })();

  const rows = [
    {
      name: trackedPlayerName,
      games: trackedGames,
      setGames: setTrackedGames,
      points: trackedPoints,
      setPoints: setTrackedPoints,
    },
    {
      name: opponentName,
      games: opponentGames,
      setGames: setOpponentGames,
      points: opponentPoints,
      setPoints: setOpponentPoints,
    },
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Skip ahead</SheetTitle>
          <SheetDescription>
            Enter the current score and capture resumes from there.
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-[1.3fr_1fr_1fr] items-center gap-2">
          <div className={KICKER}>Player</div>
          <div className={cn(KICKER, "text-center")}>Games</div>
          <div className={cn(KICKER, "text-center")}>Points</div>

          {rows.map((row) => (
            <div key={row.name} className="contents">
              <div className="truncate text-sm font-medium">{row.name}</div>
              <Input
                type="number"
                min={0}
                max={99}
                inputMode="numeric"
                aria-label={`${row.name} games`}
                value={row.games}
                onChange={(event) => {
                  row.setGames(event.target.value);
                }}
                className="h-11 text-center tabular-nums"
              />
              <Select
                value={row.points}
                onValueChange={(value) => {
                  row.setPoints(value as PointCall);
                }}
              >
                <SelectTrigger aria-label={`${row.name} points`} className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POINT_CALLS.map((call) => (
                    <SelectItem key={call} value={call}>
                      {call}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <Chips
          label="Serving next"
          value={trackedServesNext}
          onChange={setTrackedServesNext}
          options={[
            { label: trackedPlayerName, value: true },
            { label: opponentName, value: false },
          ]}
        />

        {problem !== null && <p className="text-sm text-destructive">{problem}</p>}

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Button variant="outline" onClick={onDismiss} className="h-14 text-base">
            Cancel
          </Button>
          <Button
            disabled={problem !== null}
            onClick={() => {
              onSkipToScore(target);
            }}
            className="h-14 text-base"
          >
            Skip to score
          </Button>
        </div>

        <div className="border-t border-border pt-4">
          {!endingMatch ? (
            <Button
              variant="destructive"
              onClick={() => {
                setEndingMatch(true);
              }}
              className="h-13 w-full text-base"
            >
              End match
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <div className={KICKER}>Why the match ended</div>
              <div
                role="radiogroup"
                aria-label="Why the match ended"
                className="flex flex-col gap-1.5"
              >
                {MATCH_END_REASONS.map((reason) => {
                  const selected = endReason === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setEndReason(reason);
                      }}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-sm border px-3.5 py-3 text-left transition-colors",
                        selected ? "border-primary bg-accent" : "border-border hover:bg-muted",
                      )}
                    >
                      <span>
                        <span className="block text-sm font-medium">
                          {END_REASON_COPY[reason].label}
                        </span>
                        <span className="block text-xs leading-[1.45] text-muted-foreground">
                          {END_REASON_COPY[reason].description}
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

              <Chips
                label="Match awarded to"
                value={trackedPlayerWon}
                onChange={setTrackedPlayerWon}
                options={[
                  { label: trackedPlayerName, value: true },
                  { label: opponentName, value: false },
                ]}
              />

              <Button
                variant="destructive"
                disabled={endReason === null || trackedPlayerWon === null}
                onClick={() => {
                  if (endReason === null || trackedPlayerWon === null) return;
                  onEndMatch({ reason: endReason, trackedPlayerWon });
                }}
                className="h-13 w-full text-base"
              >
                Confirm end of match
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
