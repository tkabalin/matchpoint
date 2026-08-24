import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

import { OutcomeStack } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPlayerOverviewOptions,
  getRecentFormOptions,
  listOpponentsOptions,
} from "@/lib/analytics/analytics-options";
import { formatRecord } from "@/lib/format-record";
import { cn } from "@/lib/utils";

/** All-time win/loss plus recent form, in one card: the two pieces of the old
 *  Overview tab that read as a single "how are they doing" question, so they
 *  share a card rather than sitting in two separate ones side by side.
 *
 *  All-time only, not season: there's no "season" concept anywhere in the
 *  data model (no season field on a match, nothing that defines its
 *  boundaries), so a "Season" row would be drawing a line nothing backs. */
export function PlayerRecordCard({
  playerId,
  opponentId,
}: {
  playerId: string;
  opponentId: string | null;
}) {
  const { data } = useQuery(getPlayerOverviewOptions({ path: { player_id: playerId } }));
  const { data: recentForm } = useQuery(
    getRecentFormOptions({ path: { player_id: playerId }, query: { opponentId } }),
  );
  const { data: opponents } = useQuery(listOpponentsOptions({ path: { player_id: playerId } }));

  if (!data) return <Skeleton className="h-12 w-full" />;

  const { wins, losses } = data.allTimeRecord;
  const opponentName = opponents?.find((opponent) => opponent.id === opponentId)?.name ?? null;

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

      {recentForm && (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2">
          <div className="flex items-center gap-2">
            <Activity className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-xs font-semibold text-muted-foreground">
              {`Recent form · last ${recentForm.results.length}${opponentName ? ` vs ${opponentName}` : ""}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-1 gap-1">
              {recentForm.results.map((result, index) => (
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
                recentForm.results.filter((result) => result === "win").length,
                recentForm.results.filter((result) => result !== "win").length,
              )}
            </span>
          </div>
        </div>
      )}
    </StatCard>
  );
}
