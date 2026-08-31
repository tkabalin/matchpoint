import {
  listPlayersOptions,
  listSquadMemberStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { data: squadStats } = useQuery(listSquadMemberStatsOptions());
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

  // A player with no row yet (stats haven't loaded, or the endpoint has
  // nothing for them) reads as a real zero/unranked entry rather than a
  // spinner — the roster itself already renders from the persisted cache.
  const statsByPlayerId = new Map((squadStats ?? []).map((entry) => [entry.player_id, entry]));
  const entries = roster.map((player) => {
    const member = statsByPlayerId.get(player.id);
    return {
      playerId: player.id,
      name: `${player.first_name} ${player.last_name}`,
      wins: member?.period_record.wins ?? 0,
      losses: member?.period_record.losses ?? 0,
      forcedToUnforcedRatio: member?.forced_to_unforced_ratio ?? null,
      firstServeInPercent: member?.first_serve_in_percent ?? null,
      matchesLoggedThisPeriod: member?.matches_logged_this_period ?? 0,
    };
  });

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
