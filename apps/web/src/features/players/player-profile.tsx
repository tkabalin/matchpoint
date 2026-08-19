import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import { useState } from "react";

import { AppPage, PageHeader } from "@/components/page-shell";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerLoadError } from "@/components/player-load-error";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { EditPlayerSheet } from "./edit-player-sheet";
import { H2hTab } from "./tabs/h2h-tab";
import { MatchesTab } from "./tabs/matches-tab";
import { NotesTab } from "./tabs/notes-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { RallyTab } from "./tabs/rally-tab";
import { ServeTab } from "./tabs/serve-tab";
import { TrendsTab } from "./tabs/trends-tab";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "serve", label: "Serve" },
  { value: "rally", label: "Rally" },
  { value: "matches", label: "Matches" },
  { value: "trends", label: "Trends" },
  { value: "h2h", label: "H2H" },
  { value: "notes", label: "Notes" },
];

export function PlayerProfile() {
  const { playerId } = routeApi.useParams();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
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

      {/* Single page, real tabs (not a route per tab) — MatchPoint is a mobile-first,
          installed-PWA app used courtside, where deep-linking to one facet of a player
          record isn't the usual pattern the way it is on desktop dashboards. See #157/#158. */}
      <Tabs value={tab} onValueChange={setTab}>
        {/* flex-none overrides TabsTrigger's default flex-1 (equal-width stretch) — with
            seven tabs that don't all fit, equal-width squeezing overflowed each label in
            both directions and clipped it unreadably. Sized-to-content triggers in a
            genuinely horizontally-scrollable row is what the wireframe's pill row means. */}
        <TabsList className="w-full justify-start overflow-x-auto">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="flex-none">
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab player={player} onOpenTab={setTab} />
        </TabsContent>
        <TabsContent value="serve" className="mt-4">
          <ServeTab playerId={playerId} />
        </TabsContent>
        <TabsContent value="rally" className="mt-4">
          <RallyTab playerId={playerId} />
        </TabsContent>
        <TabsContent value="matches" className="mt-4">
          <MatchesTab playerId={playerId} />
        </TabsContent>
        <TabsContent value="trends" className="mt-4">
          <TrendsTab playerId={playerId} />
        </TabsContent>
        <TabsContent value="h2h" className="mt-4">
          <H2hTab playerId={playerId} />
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <NotesTab playerId={playerId} />
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
