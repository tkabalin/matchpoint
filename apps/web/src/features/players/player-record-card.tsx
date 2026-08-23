import { useQuery } from "@tanstack/react-query";

import { OutcomeStack } from "@/components/outcome-swatch";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlayerOverviewOptions } from "@/lib/analytics/analytics-options";

/** All-time win/loss — the one piece of the old Overview tab with nowhere
 *  else to live once that tab folded into Serve/Rally + the scope panel, so
 *  it gets its own card at the top of the player's stats page.
 *
 *  All-time only, not season: there's no "season" concept anywhere in the
 *  data model (no season field on a match, nothing that defines its
 *  boundaries), so a "Season" row would be drawing a line nothing backs. */
export function PlayerRecordCard({ playerId }: { playerId: string }) {
  const { data } = useQuery(getPlayerOverviewOptions({ path: { player_id: playerId } }));

  if (!data) return <Skeleton className="h-12 w-full" />;

  const { wins, losses } = data.allTimeRecord;

  return (
    <StatCard title="Win/loss record">
      <div className="flex justify-between text-xs">
        <span>All-time</span>
        <span className="tabular-nums">{`${wins}–${losses}`}</span>
      </div>
      <OutcomeStack
        className="mt-1"
        segments={[
          { pattern: "win", weight: wins, label: `${wins} won` },
          { pattern: "unforced", weight: losses, label: `${losses} lost` },
        ]}
      />
    </StatCard>
  );
}
