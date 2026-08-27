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
 *
 * Tapping the score opens the score editor — the most discoverable place to put it,
 * and it leaves the press-and-hold on skip free to do the same thing for a thumb
 * already resting there. A set the coach declared rather than watched is marked with a
 * dotted rule and says so to a screen reader: a filled-in 6-0 must never read as fact.
 */

import { ArrowLeft, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { Match } from "./match";
import { NoteButton } from "./note-button";
import type { Server } from "./point";
import { scoreboardFor } from "./score";
import type { Scoreboard } from "./score";
import { maxSetsFor } from "./state";

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
  board,
  server,
  trackedPlayerName,
  opponentName,
  onBack,
  onSkipPoint,
  onEditScore,
  onAddNote,
}: {
  match: Match;
  board: Scoreboard;
  // Who is serving the point being captured — the draft's own server, not a
  // derivation: the point is already under way by the time this renders.
  server: Server;
  trackedPlayerName: string;
  opponentName: string;
  // Null where there is nothing behind the coach — the button greys out rather than
  // disappearing, so the header keeps its shape.
  onBack: (() => void) | null;
  onSkipPoint: (won: boolean) => void;
  onEditScore: () => void;
  onAddNote: (text: string) => void;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the hold has crossed HOLD_MS, so the click that follows the release
  // opens skip-ahead instead of asking who won.
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

  const scoreboard = scoreboardFor(match, board);
  const completedSets = board.completedSets;

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
      {/* Greyed rather than gone, so the header keeps its shape and the coach can see
          the control is there and unavailable. aria-disabled rather than disabled: a
          disabled button leaves the tab order, so the one person who most needs to be
          told why nothing happens is the one who can never reach it. With no handler
          attached, the tap does nothing on its own. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label={onBack === null ? "Back, nothing to go back to" : "Back"}
        aria-disabled={onBack === null}
        onClick={onBack ?? undefined}
        className={cn(onBack === null && "opacity-50")}
      >
        <ArrowLeft className="size-5" />
      </Button>

      {/* The button sits over the table rather than around it: a table is not phrasing
          content, so it cannot legally live inside a button. */}
      <div className="relative rounded-lg border border-border bg-card px-2 py-[5px]">
        <button
          type="button"
          aria-label="Edit score"
          onClick={onEditScore}
          className="absolute inset-0 z-10 rounded-lg"
        />
        <table className="border-separate border-spacing-[3px]" aria-label="Score">
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <PlayerCell name={row.name} serving={row.serving} />
                {Array.from({ length: columnCount }, (_, index) => {
                  const observed = scoreboard.observed[index] ?? null;
                  const declared = observed === "partial" || observed === "none";
                  return (
                    <td
                      key={index}
                      className={cn(
                        "w-5 text-center text-[11px] leading-[14px] tabular-nums",
                        toneFor(index),
                        declared && "border-b border-dotted border-muted-foreground",
                      )}
                    >
                      {row.cells[index] ?? ""}
                      {declared && <span className="sr-only"> (not fully recorded)</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-1">
        <NoteButton onAddNote={onAddNote} />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Skip point"
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onContextMenu={(event) => {
            // The sheet mounts under the still-down finger and swallows the click this
            // gesture would have produced, so nothing consumes the flag. A later tap
            // clears it on its own pointerdown; a keyboard activation was left stuck.
            event.preventDefault();
            cancelHold();
            onEditScore();
          }}
          onClick={() => {
            // Opening the editor waits for this click rather than firing straight out
            // of the hold timer: a still-held mouse button has no element under it yet
            // to dismiss, so the sheet's own outside-press handling can't catch its own
            // trigger click and close what it just opened. A keyboard activation never
            // starts a hold, so it always lands here as a plain tap.
            if (holdFired.current) {
              holdFired.current = false;
              onEditScore();
              return;
            }
            setAskingWinner(true);
          }}
        >
          <SkipForward className="size-5" />
        </Button>
      </div>

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
