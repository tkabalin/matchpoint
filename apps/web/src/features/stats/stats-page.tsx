import type { Surface } from "@matchpoint/api-client";
import {
  listPlayersOptions,
  listSquadMemberStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { ChipRow } from "@/components/chip-row";
import { AppPage, PageHeader } from "@/components/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  SquadLeaderboardMetricKey,
  SquadTrendMetricKey,
} from "@/lib/analytics/types.provisional";
import { getErrorStatus } from "@/lib/error-status";
import { SURFACE_ICON } from "@/lib/tennis-labels";

import { PlayerInsightsCard } from "./player-insights-card";
import { SquadHeadlineCard } from "./squad-headline-card";
import { SquadLeaderboardCard } from "./squad-leaderboard-card";
import { SquadTrendCard } from "./squad-trend-card";

type SquadSurfaceFilter = "all" | Surface;

// Deliberately not data-driven the way the player page's own surface chips
// are (#225's product decision): this is one shared filter for the whole
// roster rather than one player's own matches, and carpet is left out on
// purpose. It's effectively extinct in tennis, and a squad-wide filter is a
// worse place than a single player's page to first decide whether it's
// worth showing at all.
const SURFACE_OPTIONS: { value: SquadSurfaceFilter; label: string; icon?: LucideIcon }[] = [
  { value: "all", label: "All" },
  { value: "hard", label: "Hard", icon: SURFACE_ICON.hard },
  { value: "clay", label: "Clay", icon: SURFACE_ICON.clay },
  { value: "grass", label: "Grass", icon: SURFACE_ICON.grass },
];

/**
 * "How does my squad compare, and how are we trending as a group?" — the
 * coach-wide counterpart to the per-player Serve/Rally stats page.
 */
export function StatsPage() {
  const { data: roster, isError, error } = useQuery(listPlayersOptions());
  const [surface, setSurface] = useState<SquadSurfaceFilter>("all");
  const surfaceQuery = surface === "all" ? undefined : surface;
  const { data: squadStats } = useQuery(
    listSquadMemberStatsOptions({ query: { surface: surfaceQuery } }),
  );
  const [leaderboardMetric, setLeaderboardMetric] = useState<SquadLeaderboardMetricKey>("record");
  const [search, setSearch] = useState("");
  const [trendMetric, setTrendMetric] = useState<SquadTrendMetricKey>("record");

  if (isError) {
    return (
      <AppPage>
        <PageHeader title="Squad stats" />
        <Alert variant="destructive">
          <AlertDescription>
            {getErrorStatus(error) === 401 ? (
              <>
                Your session has expired. <Link to="/">Sign in</Link> to see your squad stats.
              </>
            ) : (
              "Could not load squad stats."
            )}
          </AlertDescription>
        </Alert>
      </AppPage>
    );
  }

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
      forcedCount: member?.period_forced_errors_induced ?? 0,
      unforcedCount: member?.period_unforced_errors ?? 0,
      forcedToUnforcedRatio: member?.period_forced_to_unforced_ratio ?? null,
      firstServeInPercent: member?.period_first_serve_in_percent ?? null,
      matchesLoggedThisPeriod: member?.matches_logged_this_period ?? 0,
      forcedErrorsSuffered: member?.period_forced_errors_suffered ?? 0,
      pointsWon: member?.period_points_won ?? 0,
    };
  });

  return (
    <AppPage>
      <PageHeader title="Squad stats" />
      <ChipRow<SquadSurfaceFilter>
        aria-label="Surface"
        options={SURFACE_OPTIONS}
        value={surface}
        onChange={setSurface}
      />
      <SquadHeadlineCard entries={entries} />
      <PlayerInsightsCard players={roster} surface={surfaceQuery} />
      <SquadLeaderboardCard
        entries={entries}
        players={roster}
        metric={leaderboardMetric}
        onMetricChange={setLeaderboardMetric}
        search={search}
        onSearchChange={setSearch}
      />
      <SquadTrendCard metric={trendMetric} onMetricChange={setTrendMetric} surface={surfaceQuery} />
    </AppPage>
  );
}
