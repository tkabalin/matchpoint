import { getCurrentPlayerOptions, listOpponentsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { PLAYER_TABS } from "@/components/nav-tabs";
import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { RallyTab } from "@/components/rally-tab";
import { ServeRallyToggle } from "@/components/serve-rally-toggle";
import { ServeTab } from "@/components/serve-tab";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsFilters } from "@/lib/analytics/types.provisional";

import { PlayerDetailsCard } from "./player-details-card";
import { PlayerRecordCard } from "./player-record-card";
import { PlayerSurfaceRecordCard } from "./player-surface-record-card";
import { StatsScopePanel } from "./stats-scope-panel";

// Avoids a circular import between this component and its route file — same pattern
// player-profile.tsx uses for the coach's equivalent screen.
const routeApi = getRouteApi("/_player/me");

type Tab = "serve" | "rally";

/**
 * A player's whole app: their own record, details and Serve/Rally breakdown — the
 * same cards `player-profile.tsx` shows a coach, minus everything that's coach-only
 * (editing, notes, starting a match). Built on `getCurrentPlayerOptions`, never
 * `getPlayerOptions`: a player session 401s on the coach-only `GET /players/{id}`
 * even for its own id (#203).
 */
export function PlayerSelfView() {
  const filters = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [tab, setTab] = useState<Tab>("serve");
  const { data: player, isPending } = useQuery(getCurrentPlayerOptions());
  // Same query the scope panel reads (same queryKey, so this doesn't add a second
  // request) — read here too so the record card's "Recent form" caption can name
  // the opponent it's scoped to.
  const { data: opponents } = useQuery({
    ...listOpponentsOptions({ path: { player_id: player?.id ?? "" } }),
    enabled: player !== undefined,
  });

  function setFilters(next: StatsFilters) {
    navigate({ search: next, replace: true });
  }

  // Same reasoning as player-profile.tsx: a stale opponent key sends the scope back
  // to "all matches" rather than leaving a tab stuck on an error.
  function handleOpponentNotFound() {
    setFilters({ ...filters, scope: "all", opponentKey: null });
  }

  if (isPending || !player) {
    return (
      <AppPage tabs={PLAYER_TABS}>
        <Skeleton className="h-96 w-full" />
      </AppPage>
    );
  }

  const opponentName =
    (opponents ?? []).find((opponent) => opponent.key === filters.opponentKey)?.name ?? null;

  return (
    <AppPage tabs={PLAYER_TABS}>
      <PageHeader
        title={`${player.first_name} ${player.last_name}`}
        centred
        trailing={<PlayerAvatar player={player} size="sm" />}
      />

      <StatsScopePanel playerId={player.id} filters={filters} onApply={setFilters} />

      {/* Stacked, matching player-profile.tsx's own coach-facing layout. */}
      <div className="flex flex-col gap-3">
        <PlayerDetailsCard player={player} />
        <PlayerRecordCard
          playerId={player.id}
          opponentKey={filters.opponentKey}
          opponentName={opponentName}
          surface={filters.surface}
          onOpponentNotFound={handleOpponentNotFound}
        />
      </div>

      <PlayerSurfaceRecordCard playerId={player.id} />

      <ServeRallyToggle value={tab} onValueChange={setTab} />

      <div className="mt-4">
        {tab === "serve" ? (
          <ServeTab
            playerId={player.id}
            set={filters.set}
            phase={filters.phase}
            opponentKey={filters.opponentKey}
            surface={filters.surface}
            onOpponentNotFound={handleOpponentNotFound}
          />
        ) : (
          <RallyTab
            playerId={player.id}
            set={filters.set}
            phase={filters.phase}
            opponentKey={filters.opponentKey}
            surface={filters.surface}
            onOpponentNotFound={handleOpponentNotFound}
          />
        )}
      </div>
    </AppPage>
  );
}
