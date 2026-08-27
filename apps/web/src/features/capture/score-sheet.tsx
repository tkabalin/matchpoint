/**
 * The score editor — the coach states what the scoreboard says, and capture carries on
 * from there.
 *
 * One sheet for two jobs that turn out to be the same job: skipping ahead (fill in the
 * cells) and correcting a wrong score (change the wrong cell). It is pre-filled from
 * the board the log already folded to, so neither is a fresh form.
 *
 * Nothing here invents points. What it produces is a `ScoreCheckpoint`: the scoreboard
 * the coach vouches for, appended to the log like a point. Refusals name the cell they
 * belong to rather than printing a paragraph, so a mistyped game count highlights the
 * game count.
 *
 * Ending the match asks who won as well as why. A retirement's winner is the player who
 * didn't retire, and a walkover or default has no score to read one off at all, so
 * Match.outcomeOverride can't be filled without it.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { ScoreCheckpoint } from "./checkpoint";
import type { ScoreSnapshot, SetSnapshot } from "./checkpoint";
import { MATCH_END_REASONS } from "./match";
import type { Match, MatchEndReason } from "./match";
import type { Server } from "./point";
import {
  firstServerImpliedBy,
  interpretSnapshot,
  nextServerFor,
  snapshotOf,
  validateCheckpoint,
} from "./score";
import type { Scoreboard, ScoreProblem } from "./score";
import { isAdScoringFor, maxSetsFor, setRulesFor } from "./state";

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

// Raw point counts, in the order the chips are shown. AD is 4 against the other side's
// 3, which is the canonical pair every "advantage" folds to.
const CALLS = [
  { label: "0", value: 0 },
  { label: "15", value: 1 },
  { label: "30", value: 2 },
  { label: "40", value: 3 },
  { label: "AD", value: 4 },
] as const;

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

interface Cell {
  tracked: string;
  opponent: string;
}

const blank = (): Cell => ({ tracked: "", opponent: "" });

function cellOf(pair: { tracked: number; opponent: number } | null): Cell {
  return pair === null
    ? blank()
    : { tracked: String(pair.tracked), opponent: String(pair.opponent) };
}

// A column counts as entered when either side has something in it — a set nobody has
// started is two blank cells, not 0-0.
function entered(cell: Cell): boolean {
  return cell.tracked.trim() !== "" || cell.opponent.trim() !== "";
}

function toNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : Number(trimmed);
}

/** The columns the sheet opens with: every set the board knows about, then blanks. */
function initialColumns(board: Scoreboard, maxSets: number) {
  const snapshot = snapshotOf(board);
  const games: Cell[] = [];
  const tiebreaks: Cell[] = [];
  for (let index = 0; index < maxSets; index += 1) {
    const set = snapshot.sets[index];
    games.push(
      set === undefined ? blank() : cellOf({ tracked: set.tracked, opponent: set.opponent }),
    );
    tiebreaks.push(set === undefined ? blank() : cellOf(set.tiebreak));
  }
  return { games, tiebreaks, game: snapshot.game };
}

export function ScoreSheet({
  match,
  board,
  hasEvents,
  trackedPlayerName,
  opponentName,
  onSetScore,
  onEndMatch,
  onDismiss,
}: {
  match: Match;
  board: Scoreboard;
  // False before anything at all has been recorded, where "serving next" pins who
  // served first rather than being checked against it.
  hasEvents: boolean;
  trackedPlayerName: string;
  opponentName: string;
  onSetScore: (checkpoint: {
    after: ScoreSnapshot;
    servesNext: Server;
    orderChanged: boolean;
  }) => void;
  onEndMatch: (outcome: { reason: MatchEndReason; trackedPlayerWon: boolean }) => void;
  onDismiss: () => void;
}) {
  const maxSets = maxSetsFor(match.scoringSystem);
  const isAdScoring = isAdScoringFor(match.scoringSystem);
  const [initial] = useState(() => initialColumns(board, maxSets));
  const [games, setGames] = useState<Cell[]>(initial.games);
  const [tiebreaks, setTiebreaks] = useState<Cell[]>(initial.tiebreaks);
  const [game, setGame] = useState(initial.game ?? { tracked: 0, opponent: 0 });
  // Opens agreeing with the board, so a correction only has to touch what is wrong.
  const [servesNext, setServesNext] = useState<Server>(() => nextServerFor(board));
  const [orderChanged, setOrderChanged] = useState(false);

  const [endingMatch, setEndingMatch] = useState(false);
  const [endReason, setEndReason] = useState<MatchEndReason | null>(null);
  const [trackedPlayerWon, setTrackedPlayerWon] = useState<boolean | null>(null);

  const lastEntered = games.reduce((last, cell, index) => (entered(cell) ? index : last), -1);
  // The sets the snapshot will carry, and one spare column beyond them: without a blank
  // column to type into there is no way to record a set that hasn't started here yet,
  // which is exactly the coach who joined the match late.
  const setCount = Math.max(lastEntered + 1, 1);
  const columnCount = Math.min(setCount + 1, maxSets);
  const rulesFor = (index: number) => setRulesFor(match.scoringSystem, index + 1, maxSets);

  // A breaker row belongs under a set sitting at its threshold, already recorded as a
  // breaker win, or played as a breaker outright (the match-tiebreak decider).
  const showsTiebreak = (index: number) => {
    const rules = rulesFor(index);
    if (rules.gamesToWin === 0) return true;
    if (rules.tiebreakAt === null) return false;
    const tracked = toNumber(games[index]?.tracked ?? "");
    const opponent = toNumber(games[index]?.opponent ?? "");
    const threshold = rules.tiebreakAt;
    const atThreshold = tracked === threshold && opponent === threshold;
    const credited =
      (tracked === threshold + 1 && opponent === threshold) ||
      (opponent === threshold + 1 && tracked === threshold);
    return atThreshold || credited;
  };

  const sets: SetSnapshot[] = games.slice(0, setCount).map((cell, index): SetSnapshot => {
    const tiebreakCell = tiebreaks[index] ?? blank();
    return {
      tracked: toNumber(cell.tracked),
      opponent: toNumber(cell.opponent),
      tiebreak:
        showsTiebreak(index) && entered(tiebreakCell)
          ? { tracked: toNumber(tiebreakCell.tracked), opponent: toNumber(tiebreakCell.opponent) }
          : null,
    };
  });

  // Whether a game is in progress at all is the engine's answer, not a second reading
  // of the rules here: the sets alone decide it, and they equally say "in a breaker"
  // and "the match is over", both of which a game score would contradict.
  const probe = interpretSnapshot(match, { sets, game: null });
  const wantsGame =
    "board" in probe && probe.board.currentSet !== null && !probe.board.currentSet.inBreaker;
  const snapshot: ScoreSnapshot = { sets, game: wantsGame ? game : null };

  const gap = games.slice(0, setCount).findIndex((cell) => !entered(cell));
  const checkpoint =
    gap === -1
      ? ScoreCheckpoint.create({
          id: "score-sheet-preview",
          matchId: match.matchId,
          timestamp: 0,
          sequence: 0,
          after: snapshot,
          servesNext,
          orderChanged,
        })
      : null;
  const problems: ScoreProblem[] =
    checkpoint === null
      ? [{ cell: `set:${String(gap + 1)}`, message: "Fill in this set before a later one." }]
      : validateCheckpoint(match, board, checkpoint, { hasEvents });

  const problemFor = (cell: string) => problems.find((problem) => problem.cell === cell);
  const orderProblem = problemFor("servesNext");
  const generalProblems = problems.filter(
    (problem) => !problem.cell.startsWith("set:") && problem.cell !== "servesNext",
  );

  // On an empty log the answer defines the rotation, so the sheet says what it just
  // decided rather than checking it against a toss the coach may have got wrong.
  const implied =
    !hasEvents && checkpoint !== null
      ? (() => {
          const read = interpretSnapshot(match, snapshot);
          if ("problems" in read) return null;
          return firstServerImpliedBy(read.board, servesNext);
        })()
      : null;

  const updateCell = (setter: typeof setGames, index: number, side: keyof Cell, value: string) => {
    setter((current) =>
      current.map((cell, cellIndex) => (cellIndex === index ? { ...cell, [side]: value } : cell)),
    );
  };

  const pickCall = (side: keyof Cell, value: number) => {
    setGame((current) => {
      const other = side === "tracked" ? "opponent" : "tracked";
      // Only one side can hold advantage, and it always stands against the other's 40.
      const clamped = value === 4 ? 3 : current[other];
      return { ...current, [side]: value, [other]: clamped } as typeof current;
    });
  };

  const rows: { name: string; side: keyof Cell }[] = [
    { name: trackedPlayerName, side: "tracked" },
    { name: opponentName, side: "opponent" },
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md gap-4 overflow-y-auto rounded-t-sm p-5"
      >
        <SheetHeader className="p-0">
          <SheetTitle>Score</SheetTitle>
          <SheetDescription>
            Enter what the scoreboard says and capture carries on from there.
          </SheetDescription>
        </SheetHeader>

        <div
          className="grid items-center gap-1.5"
          style={{ gridTemplateColumns: `1.3fr repeat(${String(columnCount)}, 1fr)` }}
        >
          <div className={KICKER}>Player</div>
          {Array.from({ length: columnCount }, (_, index) => (
            <div key={index} className={cn(KICKER, "text-center")}>
              {rulesFor(index).tiebreakAt === null ? "Set (no TB)" : `Set ${String(index + 1)}`}
            </div>
          ))}

          {rows.map((row) => (
            <div key={row.side} className="contents">
              <div className="truncate text-sm font-medium">{row.name}</div>
              {Array.from({ length: columnCount }, (_, index) => (
                <Input
                  key={index}
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  aria-label={`${row.name} set ${String(index + 1)} games`}
                  aria-invalid={problemFor(`set:${String(index + 1)}`) !== undefined}
                  value={games[index]?.[row.side] ?? ""}
                  onChange={(event) => {
                    updateCell(setGames, index, row.side, event.target.value);
                  }}
                  className="h-11 px-1 text-center tabular-nums"
                />
              ))}
            </div>
          ))}

          {Array.from({ length: columnCount }, (_, index) => index)
            .filter(showsTiebreak)
            .map((index) => (
              <div key={`tiebreak-${String(index)}`} className="contents">
                <div className="truncate text-xs text-muted-foreground">
                  Set {String(index + 1)} tiebreak
                </div>
                {Array.from({ length: columnCount }, (_, column) =>
                  column === index ? (
                    <div key={column} className="grid grid-cols-2 gap-1">
                      {rows.map((row) => (
                        <Input
                          key={row.side}
                          type="number"
                          min={0}
                          max={99}
                          inputMode="numeric"
                          aria-label={`${row.name} set ${String(index + 1)} tiebreak points`}
                          aria-invalid={
                            problemFor(`set:${String(index + 1)}:tiebreak`) !== undefined
                          }
                          value={tiebreaks[index]?.[row.side] ?? ""}
                          onChange={(event) => {
                            updateCell(setTiebreaks, index, row.side, event.target.value);
                          }}
                          className="h-10 px-1 text-center tabular-nums"
                        />
                      ))}
                    </div>
                  ) : (
                    <div key={column} />
                  ),
                )}
              </div>
            ))}
        </div>

        {problems
          .filter((problem) => problem.cell.startsWith("set:"))
          .map((problem) => (
            <p key={problem.cell} className="text-sm text-destructive">
              {problem.message}
            </p>
          ))}

        {wantsGame && (
          <div className="flex flex-col gap-2" role="group" aria-label="Current game">
            <div className={KICKER}>Current game</div>
            {rows.map((row) => (
              <div key={row.side} className="flex items-center gap-2">
                <div className="w-20 shrink-0 truncate text-sm font-medium">{row.name}</div>
                <div className="flex flex-1 gap-1">
                  {CALLS.filter((call) => call.value !== 4 || isAdScoring).map((call) => (
                    <Button
                      key={call.label}
                      variant={game[row.side] === call.value ? "default" : "outline"}
                      aria-pressed={game[row.side] === call.value}
                      aria-label={`${row.name} ${call.label}`}
                      onClick={() => {
                        pickCall(row.side, call.value);
                      }}
                      className="h-10 flex-1 px-0 text-sm"
                    >
                      {call.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <Chips
          label="Serving next"
          value={servesNext === "TRACKED"}
          onChange={(next) => {
            setServesNext(next ? "TRACKED" : "OPPONENT");
            setOrderChanged(false);
          }}
          options={[
            { label: trackedPlayerName, value: true },
            { label: opponentName, value: false },
          ]}
        />

        {implied !== null && (
          <p className="text-sm text-muted-foreground">
            So {implied === "TRACKED" ? trackedPlayerName : opponentName} served first.
          </p>
        )}

        {orderChanged && (
          <p className="text-sm text-muted-foreground">
            Recorded as a change of serving order from here on.
          </p>
        )}

        {generalProblems.map((problem) => (
          <p key={problem.cell} className="text-sm text-destructive">
            {problem.message}
          </p>
        ))}

        {orderProblem !== undefined && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{orderProblem.message}</p>
            <Button
              variant="outline"
              onClick={() => {
                setOrderChanged(true);
              }}
              className="h-11 text-sm"
            >
              The order changed on court
            </Button>
          </div>
        )}

        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Button variant="outline" onClick={onDismiss} className="h-14 text-base">
            Cancel
          </Button>
          <Button
            disabled={problems.length > 0}
            onClick={() => {
              if (problems.length > 0) return;
              onSetScore({ after: snapshot, servesNext, orderChanged });
            }}
            className="h-14 text-base"
          >
            Set score
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
