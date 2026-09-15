import { getPlayerOptions, listOpponentsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Play } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerLoadError } from "@/components/player-load-error";
import { RallyTab } from "@/components/rally-tab";
import { ServeRallyToggle } from "@/components/serve-rally-toggle";
import { ServeTab } from "@/components/serve-tab";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsFilters } from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

import { EditPlayerSheet } from "./edit-player-sheet";
import { PlayerDetailsCard } from "./player-details-card";
import { PlayerRecordCard } from "./player-record-card";
import { PlayerSurfaceRecordCard } from "./player-surface-record-card";
import { StatsScopePanel } from "./stats-scope-panel";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

type Tab = "serve" | "rally";

export function PlayerProfile() {
  const router = useRouter();
  const { playerId } = routeApi.useParams();
  // The committed scope/set/phase filters live in the URL (validated by the
  // route's own `validateSearch`), not component state — so they survive a
  // reload or a back/forward navigation instead of silently resetting.
  const filters = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [tab, setTab] = useState<Tab>("serve");
  const [editing, setEditing] = useState(false);
  const {
    data: player,
    isPending,
    isError,
    error,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  // Same query the scope panel reads (same queryKey, so this doesn't add a
  // second request) — read here too so the record card's "Recent form"
  // caption can name the opponent it's scoped to.
  const { data: opponents } = useQuery(listOpponentsOptions({ path: { player_id: playerId } }));

  function setFilters(next: StatsFilters) {
    navigate({ search: next, replace: true });
  }

  // A stale opponent key (its matches renamed or deleted since the picker
  // offered it, or a bookmarked/shared URL that's gone out of date) sends
  // the scope back to "all matches" rather than leaving a tab stuck on an
  // error — matching the API's own reasoning for declaring this as a 404
  // rather than an empty result (see `analytics.py`'s `OPPONENT_NOT_FOUND`).
  function handleOpponentNotFound() {
    setFilters({ ...filters, scope: "all", opponentKey: null });
  }

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
  const opponentName =
    (opponents ?? []).find((opponent) => opponent.key === filters.opponentKey)?.name ?? null;

  return (
    <AppPage nav={false}>
      <PageHeader
        title={playerName}
        centred
        back={
          // Reachable from Home (roster tile, continue-with card) and from the
          // Players tab's own card now, so a fixed destination would send half
          // of those visits somewhere they didn't come from — same reasoning
          // as `legal-page.tsx`'s own back button. Pops real browser history,
          // falling back to Home only for a direct/deep link with nothing to
          // pop.
          <button
            type="button"
            aria-label="Back"
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            onClick={() => {
              if (router.history.canGoBack()) {
                router.history.back();
              } else {
                void router.navigate({ to: "/home" });
              }
            }}
          >
            <ArrowLeft />
          </button>
        }
        trailing={
          // The photo is the second way into the edit sheet, beside the details
          // card's own pencil: tapping a person's picture to edit them is the
          // convention everywhere else. No camera badge, though. That signifier
          // means "change photo" throughout the app, and this opens the whole
          // player, not the picker. Sized to match the back button opposite it.
          <button
            type="button"
            aria-label={`Edit ${playerName}`}
            onClick={() => {
              setEditing(true);
            }}
            className="flex size-8 shrink-0 items-center justify-center"
          >
            <PlayerAvatar player={player} size="sm" />
          </button>
        }
      />

      {/* The single most frequent action on this page (Pareto's/Fitts's laws)
          — large, filled and icon-led so it doesn't get lost next to the
          cards below it, the way the old small outline link did. */}
      <Link
        to="/new-match/$playerId"
        params={{ playerId }}
        className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
      >
        <Play />
        Start match
      </Link>

      <EditPlayerSheet player={player} open={editing} onOpenChange={setEditing} />

      <StatsScopePanel playerId={playerId} filters={filters} onApply={setFilters} />

      {/* Stacked, not side by side — the details card now carries the full
          notes list inline, which grows however tall it needs to and no
          longer fits a shared-height 2-column row with the record card. */}
      <div className="flex flex-col gap-3">
        <PlayerDetailsCard player={player} onEdit={() => setEditing(true)} />
        <PlayerRecordCard
          playerId={playerId}
          opponentKey={filters.opponentKey}
          opponentName={opponentName}
          surface={filters.surface}
          onOpponentNotFound={handleOpponentNotFound}
        />
      </div>

      {/* Standing, not scoped by the panel above — shows every surface at
          once so "how do they do on clay" doesn't cost cycling through each
          one via the scope panel's own surface chip (#225). */}
      <PlayerSurfaceRecordCard playerId={playerId} />

      <ServeRallyToggle value={tab} onValueChange={setTab} />

      <div className="mt-4">
        {tab === "serve" ? (
          <ServeTab
            playerId={playerId}
            set={filters.set}
            phase={filters.phase}
            opponentKey={filters.opponentKey}
            surface={filters.surface}
            onOpponentNotFound={handleOpponentNotFound}
          />
        ) : (
          <RallyTab
            playerId={playerId}
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
