/**
 * The result screen — how the match finished, once it has.
 *
 * Everything shown is derived from the folded board and the match: the winner through
 * `finalWinnerFor`, which is the one place an outcome override (a retirement, walkover
 * or default) beats the set count. Expects a decided match; the caller only reaches
 * here when `isMatchOver` says so.
 *
 * The match is not finished server-side until the coach leaves this screen, which is
 * what leaves room for "Undo last point": completion is one-way on the server, so a
 * mis-tapped match point has to be recoverable before it is sent, not after. Coverage
 * is shown in games rather than as a percentage — an exact count of what was watched
 * beats a point estimate of it.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Match } from "./match";
import type { MatchSet } from "./match-set";
import { coverageOf, matchSetsOf, observedOf } from "./score";
import type { Scoreboard } from "./score";
import { finalWinnerFor, maxSetsFor, setRulesFor } from "./state";

// A set with no games phase records its breaker instead, so it shows in brackets —
// the same convention scoreboardFor uses for the live header.
function setScores(matchSet: MatchSet, match: Match, maxSets: number) {
  const rules = setRulesFor(match.scoringSystem, matchSet.setNumber, maxSets);
  if (rules.gamesToWin === 0 && matchSet.tiebreak !== null) {
    return {
      trackedPlayer: `[${String(matchSet.tiebreak.trackedPlayerPoints)}]`,
      opponent: `[${String(matchSet.tiebreak.opponentPoints)}]`,
    };
  }
  return {
    trackedPlayer: String(matchSet.trackedPlayerGames),
    opponent: String(matchSet.opponentGames),
  };
}

export function ResultScreen({
  match,
  board,
  trackedPlayerName,
  opponentName,
  onUndo,
  onFinish,
  onHome,
  onViewResults,
}: {
  match: Match;
  board: Scoreboard;
  trackedPlayerName: string;
  opponentName: string;
  // Null once there is nothing left to unwind, or when the match ended by retirement,
  // walkover or default — none of those are a score to take a point back off.
  onUndo: (() => void) | null;
  onFinish: () => void;
  onHome: () => void;
  onViewResults: () => void;
}) {
  const completedSets = matchSetsOf(board);
  const coverage = coverageOf(board);
  const winner = finalWinnerFor(match, completedSets);
  const won = winner === match.trackedPlayerId;
  const maxSets = maxSetsFor(match.scoringSystem);

  const scores = completedSets.map((matchSet, index) => ({
    setNumber: matchSet.setNumber,
    wonBySet: matchSet.winner === match.trackedPlayerId,
    declared:
      observedOf(board.completedSets[index] ?? { slotsPlayed: 0, slotsObserved: 0 }) !== "full",
    ...setScores(matchSet, match, maxSets),
  }));

  const scoreLine = scores
    .map((score) =>
      won ? `${score.trackedPlayer}-${score.opponent}` : `${score.opponent}-${score.trackedPlayer}`,
    )
    .join(", ");
  // A walkover can finish a match with no sets at all, so the score half is dropped
  // rather than left as a dangling separator.
  const summary = [
    `${won ? trackedPlayerName : opponentName} d. ${won ? opponentName : trackedPlayerName}`,
    scoreLine,
    match.outcomeOverride === null ? null : `(${match.outcomeOverride.reason})`,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ");

  const rows = [
    { name: trackedPlayerName, cells: scores.map((score) => score.trackedPlayer), tracked: true },
    { name: opponentName, cells: scores.map((score) => score.opponent), tracked: false },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <h1
        className={cn(
          "text-[56px] leading-none font-semibold tracking-[-0.03em]",
          won ? "text-court" : "text-muted-foreground",
        )}
      >
        {won ? "Win" : "Loss"}
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">{summary}</p>

      <div className="mt-7">
        <div className="pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          Score
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-normal">
                  Player
                </th>
                {scores.map((score) => (
                  <th key={score.setNumber} scope="col" className="py-2 font-normal">
                    S{score.setNumber}
                    {score.declared && <span className="sr-only"> (not fully recorded)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-border">
                  <th scope="row" className="px-3 py-[11px] text-left font-normal">
                    {row.name}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td
                      key={scores[index]?.setNumber ?? index}
                      className={cn(
                        "py-[11px] text-center",
                        scores[index]?.wonBySet === row.tracked
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          scores[index]?.declared === true &&
                            "border-b border-dotted border-muted-foreground",
                        )}
                      >
                        {cell}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {coverage.slotsObserved === coverage.slotsPlayed
            ? `All ${String(coverage.slotsPlayed)} games recorded.`
            : `${String(coverage.slotsObserved)} of ${String(coverage.slotsPlayed)} games fully recorded.`}
        </p>
      </div>

      <div className="flex-1" />

      {onUndo !== null && (
        <Button variant="outline" onClick={onUndo} className="mb-2 h-12 w-full text-base">
          Undo last point
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onHome} className="h-14 text-base">
          Home
        </Button>
        <Button onClick={onViewResults} className="h-14 text-base">
          Match statistics
        </Button>
      </div>
      <Button variant="ghost" onClick={onFinish} className="mt-2 h-11 w-full text-sm">
        Finish match
      </Button>
    </div>
  );
}
