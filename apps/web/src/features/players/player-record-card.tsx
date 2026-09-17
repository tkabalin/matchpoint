import { getPlayerOverviewOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, Trophy } from "lucide-react";
import { useEffect } from "react";

import { ResultDots } from "@/components/result-dots";
import { StatCard } from "@/components/stat-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { SurfaceFilter } from "@/lib/analytics/types.provisional";
import { getErrorStatus } from "@/lib/error-status";

/** All-time win/loss plus recent form, in one card: the two pieces of the old
 *  Overview tab that read as a single "how are they doing" question, so they
 *  share a card rather than sitting in two separate ones side by side.
 *
 *  All-time only, and the endpoint now carries no other record (#298): the
 *  season-scoped one was dropped rather than left unread, so adding it here
 *  means deciding to show it and putting it back. */
export function PlayerRecordCard({
  playerId,
  opponentKey,
  opponentName,
  surface = "all",
  onOpponentNotFound,
}: {
  playerId: string;
  /** Narrows both the record and recent form to one opponent via the real
   *  `opponent_key` axis — null (or omitted) means every opponent. */
  opponentKey: string | null;
  /** Display name for the "Recent form" caption — the caller already reads
   *  this off the same `listOpponentsOptions` query the scope panel uses. */
  opponentName: string | null;
  /** Narrows the record and form to one surface via the real `surface` axis
   *  (#225) — `"all"` (or omitted) means every surface. */
  surface?: SurfaceFilter;
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
      query: {
        opponent_key: opponentKey,
        surface: surface === "all" ? undefined : surface,
      },
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
    <StatCard>
      {/* Trophy plus tick/cross counts in the outcome colors: the same
       *  headline win/loss treatment squad-headline-card.tsx's own "Win
       *  record" stat uses, per .claude/rules/web-icons.md. */}
      <div className="flex items-center gap-2">
        <Trophy className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-base font-bold text-foreground">Win/loss record</h3>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">All-time</span>
        <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
          <span className="flex items-center gap-1 text-outcome-win">
            <CircleCheck className="size-4" aria-hidden="true" />
            {wins}
          </span>
          <span className="flex items-center gap-1 text-outcome-unforced">
            <CircleX className="size-4" aria-hidden="true" />
            {losses}
          </span>
        </span>
      </div>

      {data.recent_results.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-2">
          <ResultDots
            results={data.recent_results}
            label={`Recent form · last ${data.recent_results.length}${opponentName ? ` vs ${opponentName}` : ""}`}
          />
        </div>
      )}
    </StatCard>
  );
}
