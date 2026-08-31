import { getPlayerOverviewOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useEffect } from "react";

import { OutcomeStack } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorStatus } from "@/lib/error-status";
import { formatRecord } from "@/lib/format-record";
import { cn } from "@/lib/utils";

/** All-time win/loss plus recent form, in one card: the two pieces of the old
 *  Overview tab that read as a single "how are they doing" question, so they
 *  share a card rather than sitting in two separate ones side by side.
 *
 *  All-time only, not season: the API does carry a calendar-year
 *  `season_record` now, but nothing on this card claims otherwise reading it
 *  — showing a second record here is a product decision for someone to make,
 *  not a side effect of wiring this card to real data. */
export function PlayerRecordCard({
  playerId,
  opponentKey,
  opponentName,
  onOpponentNotFound,
}: {
  playerId: string;
  /** Narrows both the record and recent form to one opponent via the real
   *  `opponent_key` axis — null (or omitted) means every opponent. */
  opponentKey: string | null;
  /** Display name for the "Recent form" caption — the caller already reads
   *  this off the same `listOpponentsOptions` query the scope panel uses. */
  opponentName: string | null;
  /** Called once if the committed opponent key doesn't match any of this
   *  player's real matches — a stale picker selection, not a bug to report.
   *  The caller falls back to "all matches" rather than leaving this card
   *  stuck on an error (see `analytics.py`'s own `OPPONENT_NOT_FOUND`
   *  comment: "a stale key sends the panel back to all matches"). */
  onOpponentNotFound?: () => void;
}) {
  const { data, isPending, isError, error } = useQuery(
    getPlayerOverviewOptions({
      path: { player_id: playerId },
      query: { opponent_key: opponentKey },
    }),
  );
  const opponentNotFound = opponentKey !== null && getErrorStatus(error) === 404;

  useEffect(() => {
    if (opponentNotFound) onOpponentNotFound?.();
  }, [opponentNotFound, onOpponentNotFound]);

  if (isPending || opponentNotFound) return <Skeleton className="h-12 w-full" />;

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the win/loss record.</AlertDescription>
      </Alert>
    );
  }

  const { wins, losses } = data.all_time_record;

  return (
    <StatCard title="Win/loss record" className="h-full">
      <div className="flex justify-between text-xs">
        <span>All-time</span>
        <span className="tabular-nums">{formatRecord(wins, losses)}</span>
      </div>
      <OutcomeStack
        className="mt-1"
        segments={[
          { pattern: "win", weight: wins, label: `${wins} won` },
          { pattern: "unforced", weight: losses, label: `${losses} lost` },
        ]}
      />

      {data.recent_results.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
          <div className="flex items-center gap-2">
            {/* History, not Activity — matches home.tsx's own "Last 5" icon for the
                same "recent form" concept, per .claude/rules/web-icons.md. */}
            <History className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-xs font-semibold text-muted-foreground">
              {`Recent form · last ${data.recent_results.length}${opponentName ? ` vs ${opponentName}` : ""}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-1">
              {data.recent_results.map((result, index) => (
                <span
                  key={index}
                  role="img"
                  aria-label={result === "win" ? "Won" : "Lost"}
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    result === "win" ? "bg-outcome-win" : "border border-muted-foreground",
                  )}
                />
              ))}
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums">
              {formatRecord(
                data.recent_results.filter((result) => result === "win").length,
                data.recent_results.filter((result) => result !== "win").length,
              )}
            </span>
          </div>
        </div>
      )}
    </StatCard>
  );
}
