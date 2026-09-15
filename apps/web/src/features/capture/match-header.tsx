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
 *
 * Back's own hold ignores whatever the tap does — stepping back a screen, stepping out
 * to setup, or asking to undo — and leaves for Home outright. Nothing has to mark the
 * match paused for that: it already is, in every sense the app tracks, the moment a
 * coach leaves without finishing it.
 */

import { ArrowLeft, SkipForward } from "lucide-react";
import { type Ref, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { hasSeenHoldTip, markHoldTipSeen } from "@/lib/hold-tip";
import { cn } from "@/lib/utils";

import type { Match } from "./match";
import { NoteButton, type NoteHandle } from "./note-button";
import type { Server } from "./point";
import { scoreboardFor } from "./score";
import type { Scoreboard } from "./score";
import { maxSetsFor } from "./state";
import { HOLD_MS, usePressAndHold } from "./use-press-and-hold";
import { WinnerSheet } from "./winner-sheet";

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
  onGoHome,
  onSkipPoint,
  onEditScore,
  onAddNote,
  noteRef,
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
  // Back's hold, independent of the tap above and never null: there is always a Home
  // to reach, even where there's nothing behind the coach to step back into.
  onGoHome: () => void;
  onSkipPoint: (won: boolean) => void;
  onEditScore: () => void;
  onAddNote: (text: string) => void;
  // How the flow takes an unfinished dictation at a point boundary, so the words land
  // on the point they describe. Forwarded straight through; the header never reads it.
  noteRef?: Ref<NoteHandle>;
}) {
  const [askingWinner, setAskingWinner] = useState(false);
  // Drives the back button's own fill bar — purely visual, so it stays a plain flag
  // beside usePressAndHold's own timer rather than something threaded through it.
  const [holdingBack, setHoldingBack] = useState(false);
  // Two independent holds, each with its own timer — sharing one instance between
  // Back and Skip would let a hold started on one button be consumed by a click on
  // the other.
  const {
    holdHandlers: backHoldHandlers,
    cancelHold: cancelBackHold,
    consumeHold: consumeBackHold,
  } = usePressAndHold();
  const {
    holdHandlers: skipHoldHandlers,
    cancelHold: cancelSkipHold,
    consumeHold: consumeSkipHold,
  } = usePressAndHold();

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
    // `relative`: NoteButton's live-transcript panel anchors to this box with
    // `absolute top-full`, so it drops down right under the header wherever it sits,
    // with no need to know the persistent app header's height above it.
    <div className="relative flex h-10 items-center justify-between gap-3">
      {/* Greyed rather than gone, so the header keeps its shape and the coach can see
          the control is there and unavailable. aria-disabled rather than disabled: a
          disabled button leaves the tab order, so the one person who most needs to be
          told why nothing happens is the one who can never reach it. The tap still
          no-ops with nothing behind it, but the hold reaches Home regardless. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label={onBack === null ? "Back, nothing to go back to" : "Back"}
        aria-disabled={onBack === null}
        {...backHoldHandlers}
        onPointerDown={() => {
          backHoldHandlers.onPointerDown();
          setHoldingBack(true);
        }}
        onPointerUp={() => {
          backHoldHandlers.onPointerUp();
          setHoldingBack(false);
        }}
        onPointerLeave={() => {
          backHoldHandlers.onPointerLeave();
          setHoldingBack(false);
        }}
        onPointerCancel={() => {
          backHoldHandlers.onPointerCancel();
          setHoldingBack(false);
        }}
        onContextMenu={(event) => {
          // Same reasoning as skip's handler below: a touch long-press's contextmenu
          // can fire before the click that would otherwise consume the hold, so this
          // triggers Home directly rather than leaving it to a click that might not land.
          event.preventDefault();
          cancelBackHold();
          setHoldingBack(false);
          onGoHome();
        }}
        onClick={() => {
          if (consumeBackHold()) {
            onGoHome();
            return;
          }
          // Hold always does something different here, whether or not there's
          // anywhere for the tap to step back into — worth surfacing once.
          if (!hasSeenHoldTip("back")) {
            markHoldTipSeen("back");
            toast.info("Tip: press and hold to jump straight home");
          }
          onBack?.();
        }}
        className={cn("relative overflow-hidden", onBack === null && "opacity-50")}
      >
        <ArrowLeft className="size-5" />
        {/* Fills left-to-right over the same HOLD_MS the timer itself runs on, so a
            coach sees exactly how much longer to hold rather than guessing. Snaps back
            with no transition on release — held long enough or not, the bar has no
            reason to still be there once the press ends. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
          style={{
            transform: holdingBack ? "scaleX(1)" : "scaleX(0)",
            transitionProperty: "transform",
            transitionDuration: holdingBack ? `${String(HOLD_MS)}ms` : "0ms",
            transitionTimingFunction: "linear",
          }}
        />
      </Button>

      {/* A keyboard or switch activation dispatches a click with no pointerdown, so it
          can never hold: without this there is no route straight to Home for anyone
          who can't perform the gesture. */}
      <button
        type="button"
        onClick={onGoHome}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-ring"
      >
        Go home
      </button>

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
        <NoteButton onAddNote={onAddNote} ref={noteRef} />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Skip point"
          {...skipHoldHandlers}
          onContextMenu={(event) => {
            // The sheet mounts under the still-down finger and swallows the click this
            // gesture would have produced, so nothing consumes the flag. A later tap
            // clears it on its own pointerdown; a keyboard activation was left stuck.
            event.preventDefault();
            cancelSkipHold();
            onEditScore();
          }}
          onClick={() => {
            // Opening the editor waits for this click rather than firing straight out
            // of the hold timer: a still-held mouse button has no element under it yet
            // to dismiss, so the sheet's own outside-press handling can't catch its own
            // trigger click and close what it just opened. A keyboard activation never
            // starts a hold, so it always lands here as a plain tap.
            if (consumeSkipHold()) {
              onEditScore();
              return;
            }
            if (!hasSeenHoldTip("skip")) {
              markHoldTipSeen("skip");
              toast.info("Tip: press and hold to edit the score instead");
            }
            setAskingWinner(true);
          }}
        >
          <SkipForward className="size-5" />
        </Button>
      </div>

      <WinnerSheet
        open={askingWinner}
        description="The point is recorded with its winner and nothing else."
        trackedPlayerName={trackedPlayerName}
        opponentName={opponentName}
        onPick={skipTo}
        onEditScore={() => {
          setAskingWinner(false);
          onEditScore();
        }}
        onOpenChange={setAskingWinner}
      />
    </div>
  );
}
