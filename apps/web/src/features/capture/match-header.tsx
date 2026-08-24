/**
 * The header every in-match screen wears: step back, the live score, skip.
 *
 * The score is read straight out of `scoreboardFor` rather than counted here, and laid
 * into a grid sized for the whole match from the first point: one column per set the
 * format can reach, plus the live games and the current game's call. Cells fill in as
 * points come in, so the chip never resizes mid-match.
 *
 * Skipping asks who won before it hands the point back: `Point` has no way to record
 * one without a winner, and the score has to stay right (see the `UNUSUAL_OUTCOME`
 * step in capture-flow.ts).
 */

import { ArrowLeft, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { Match } from "./match";
import type { Point, Server } from "./point";
import { matchSetsFor, maxSetsFor, scoreboardFor } from "./state";

// Long enough that a deliberate press is unmistakable, short enough to feel like a
// hold rather than a hang. From the design handoff.
const HOLD_MS = 450;

// Completed sets recede, the live games read as the score, the current game's call is
// the one thing a coach looks at mid-point.
const CELL_TONES = {
  set: "text-muted-foreground",
  games: "font-semibold text-foreground",
  points: "rounded-sm bg-accent font-semibold text-primary",
  empty: "",
} as const;

function PlayerCell({ name, serving }: { name: string; serving: boolean }) {
  return (
    // The dot is the only thing marking the server, so the name carries it for anyone
    // who can't see the dot.
    <th
      scope="row"
      aria-label={serving ? `${name}, serving` : name}
      className="border-r border-border pr-2 text-left text-[11px] font-medium whitespace-nowrap"
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-[5px] shrink-0 rounded-full",
            serving ? "bg-court" : "bg-transparent",
          )}
        />
        {name}
      </span>
    </th>
  );
}

export function MatchHeader({
  match,
  points,
  server,
  trackedPlayerName,
  opponentName,
  onBack,
  onSkipPoint,
  onSkipAhead,
}: {
  match: Match;
  points: readonly Point[];
  // Who is serving the point being captured — the draft's own server, not a
  // derivation: the point is already under way by the time this renders.
  server: Server;
  trackedPlayerName: string;
  opponentName: string;
  onBack: () => void;
  onSkipPoint: (won: boolean) => void;
  onSkipAhead: () => void;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the hold has already opened skip-ahead, so the click that follows the
  // release doesn't also ask who won.
  const holdFired = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    };
  }, []);

  function startHold() {
    holdFired.current = false;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      holdFired.current = true;
      onSkipAhead();
    }, HOLD_MS);
  }

  function cancelHold() {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }

  function skipTo(won: boolean) {
    setAskingWinner(false);
    onSkipPoint(won);
  }

  const { completedSets } = matchSetsFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );
  const scoreboard = scoreboardFor(
    points,
    match.matchId,
    match.trackedPlayerId,
    match.opponentId,
    match.scoringSystem,
  );

  // The widest the score can get: every set but the last already completed, plus the
  // live games and the current call.
  const columnCount = maxSetsFor(match.scoringSystem) + 1;
  const filled = scoreboard.trackedPlayer.length;
  const toneFor = (index: number) => {
    if (index >= filled) return CELL_TONES.empty;
    if (index < completedSets.length) return CELL_TONES.set;
    return index === filled - 1 ? CELL_TONES.points : CELL_TONES.games;
  };

  const rows = [
    { name: trackedPlayerName, serving: server === "TRACKED", cells: scoreboard.trackedPlayer },
    { name: opponentName, serving: server === "OPPONENT", cells: scoreboard.opponent },
  ];

  return (
    <div className="flex h-10 items-center justify-between gap-3">
      <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
        <ArrowLeft className="size-5" />
      </Button>

      <div className="rounded-lg border border-border bg-card px-2 py-[5px]">
        <table className="border-separate border-spacing-[3px]" aria-label="Score">
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <PlayerCell name={row.name} serving={row.serving} />
                {Array.from({ length: columnCount }, (_, index) => (
                  <td
                    key={index}
                    className={cn(
                      "w-5 text-center text-[11px] leading-[14px] tabular-nums",
                      toneFor(index),
                    )}
                  >
                    {row.cells[index] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Skip point"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelHold();
          holdFired.current = true;
          onSkipAhead();
        }}
        onClick={() => {
          // A keyboard activation never starts a hold, so it lands here as a plain tap.
          if (holdFired.current) {
            holdFired.current = false;
            return;
          }
          setAskingWinner(true);
        }}
      >
        <SkipForward className="size-5" />
      </Button>

      <Sheet open={askingWinner} onOpenChange={setAskingWinner}>
        <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
          <SheetHeader className="p-0">
            <SheetTitle>Who won the point?</SheetTitle>
          </SheetHeader>
          <p className="text-sm text-muted-foreground">
            The point is recorded with its winner and nothing else.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                skipTo(true);
              }}
              className="h-[76px] flex-col gap-1 border-court/30 bg-court/10 hover:bg-court/20"
            >
              <span className="text-base font-semibold text-court">Win</span>
              <span className="text-xs text-muted-foreground">Point to {trackedPlayerName}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                skipTo(false);
              }}
              className="h-[76px] flex-col gap-1 border-destructive/30 bg-destructive/10 hover:bg-destructive/20"
            >
              <span className="text-base font-semibold text-destructive">Loss</span>
              <span className="text-xs text-muted-foreground">Point to {opponentName}</span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
