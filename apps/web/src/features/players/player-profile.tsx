import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, CircleDot, Pencil, Repeat2 } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerLoadError } from "@/components/player-load-error";
import { SegmentedControl } from "@/components/segmented-control";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsFilters } from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

import { EditPlayerSheet } from "./edit-player-sheet";
import { RecentFormRow } from "./recent-form-row";
import { StatsScopePanel } from "./stats-scope-panel";
import { RallyTab } from "./tabs/rally-tab";
import { ServeTab } from "./tabs/serve-tab";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

type Tab = "serve" | "rally";

const DEFAULT_FILTERS: StatsFilters = { scope: "all", opponentId: null, set: "all", phase: "full" };

export function PlayerProfile() {
  const { playerId } = routeApi.useParams();
  const [tab, setTab] = useState<Tab>("serve");
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const {
    data: player,
    isPending,
    isError,
    error,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));

  if (isPending)
    return (
      <AppPage nav={false}>
        <Skeleton className="h-96 w-full" />
      </AppPage>
    );

  if (isError)
    return (
      <AppPage nav={false}>
        <PlayerLoadError error={error} />
      </AppPage>
    );

  const playerName = `${player.first_name} ${player.last_name}`;

  return (
    <AppPage nav={false}>
      <PageHeader
        title={playerName}
        centred
        back={
          <Link
            to="/home"
            aria-label="Back to home"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        }
        trailing={<PlayerAvatar player={player} size="sm" />}
      />

      <div className="flex items-center gap-2">
        <Link
          to="/new-match/$playerId"
          params={{ playerId }}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
        >
          Start match
        </Link>

        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </div>

      <EditPlayerSheet player={player} open={editing} onOpenChange={setEditing} />

      <StatsScopePanel playerId={playerId} filters={filters} onApply={setFilters} />
      <RecentFormRow playerId={playerId} opponentId={filters.opponentId} />

      {/* Matches the mockup's own Serve/Rally toggle exactly — a bordered
          segmented pill, not the app's usual underline tabs. */}
      <SegmentedControl
        aria-label="Serve or rally"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "serve", label: "Serve", icon: CircleDot },
          { value: "rally", label: "Rally", icon: Repeat2 },
        ]}
      />

      <div className="mt-4">
        {tab === "serve" ? <ServeTab playerId={playerId} /> : <RallyTab playerId={playerId} />}
      </div>
    </AppPage>
  );
}
