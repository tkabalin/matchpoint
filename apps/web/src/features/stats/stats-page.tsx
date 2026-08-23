import { listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { squadStatsFor } from "@/lib/analytics/analytics-options";
import type { SquadMetricKey } from "@/lib/analytics/types.provisional";

import { SquadHeadlineCard } from "./squad-headline-card";
import { SquadLeaderboardCard } from "./squad-leaderboard-card";
import { SquadTrendCard } from "./squad-trend-card";

/**
 * "How does my squad compare, and how are we trending as a group?" — the
 * coach-wide counterpart to the per-player Serve/Rally stats page.
 */
export function StatsPage() {
  const { data: roster } = useQuery(listPlayersOptions());
  const [leaderboardMetric, setLeaderboardMetric] = useState<SquadMetricKey>("record");
  const [search, setSearch] = useState("");
  const [trendMetric, setTrendMetric] = useState<SquadMetricKey>("record");

  if (!roster) {
    return (
      <AppPage>
        <PageHeader title="Squad stats" />
        <Skeleton className="h-96 w-full" />
      </AppPage>
    );
  }

  const entries = roster.map((player, index) => ({
    ...squadStatsFor(player.id, index),
    name: `${player.first_name} ${player.last_name}`,
  }));

  return (
    <AppPage>
      <PageHeader title="Squad stats" />
      <SquadHeadlineCard entries={entries} />
      <SquadLeaderboardCard
        entries={entries}
        metric={leaderboardMetric}
        onMetricChange={setLeaderboardMetric}
        search={search}
        onSearchChange={setSearch}
      />
      <SquadTrendCard metric={trendMetric} onMetricChange={setTrendMetric} />
    </AppPage>
  );
}
