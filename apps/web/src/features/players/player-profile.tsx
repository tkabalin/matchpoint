import { getPlayerOptions, listOpponentsOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, CircleDot, NotebookPen, Play, Repeat2 } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerLoadError } from "@/components/player-load-error";
import { RallyTab } from "@/components/rally-tab";
import { SegmentedControl } from "@/components/segmented-control";
import { ServeTab } from "@/components/serve-tab";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsFilters } from "@/lib/analytics/types.provisional";
import { cn } from "@/lib/utils";

import { EditPlayerSheet } from "./edit-player-sheet";
import { PlayerDetailsCard } from "./player-details-card";
import { PlayerNotesSheet } from "./player-notes-sheet";
import { PlayerRecordCard } from "./player-record-card";
import { StatsScopePanel } from "./stats-scope-panel";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

type Tab = "serve" | "rally";

export function PlayerProfile() {
  const { playerId } = routeApi.useParams();
  // The committed scope/set/phase filters live in the URL (validated by the
  // route's own `validateSearch`), not component state — so they survive a
  // reload or a back/forward navigation instead of silently resetting.
  const filters = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [tab, setTab] = useState<Tab>("serve");
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
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

      <div className="grid grid-cols-2 items-stretch gap-3">
        <PlayerRecordCard
          playerId={playerId}
          opponentKey={filters.opponentKey}
          opponentName={opponentName}
          onOpponentNotFound={handleOpponentNotFound}
        />
        <PlayerDetailsCard player={player} onEdit={() => setEditing(true)} />
      </div>

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
        {tab === "serve" ? (
          <ServeTab
            playerId={playerId}
            set={filters.set}
            phase={filters.phase}
            opponentKey={filters.opponentKey}
            onOpponentNotFound={handleOpponentNotFound}
          />
        ) : (
          <RallyTab
            playerId={playerId}
            set={filters.set}
            phase={filters.phase}
            opponentKey={filters.opponentKey}
            onOpponentNotFound={handleOpponentNotFound}
          />
        )}
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={() => setNotesOpen(true)}>
        <NotebookPen />
        Notes
      </Button>

      <PlayerNotesSheet playerId={playerId} open={notesOpen} onOpenChange={setNotesOpen} />
    </AppPage>
  );
}
