import { getPlayerOptions, listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { PlayerAvatar } from "@/components/player-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Avoids a circular import between this component and its route file — the
// standard TanStack Router way to read typed params from outside the route file.
const routeApi = getRouteApi("/_authenticated/players/$playerId");

export function PlayerProfile() {
  const { playerId } = routeApi.useParams();
  const {
    data: player,
    isPending,
    isError,
  } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  const { data: matches } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));

  if (isPending) return <p>Loading player…</p>;
  if (isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load that player.</AlertDescription>
      </Alert>
    );

  const playerName = `${player.first_name} ${player.last_name}`;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/home">← Home</Link>
        <div className="flex items-center gap-2">
          <PlayerAvatar player={player} />
          <h1 className="font-semibold">{playerName}</h1>
        </div>
        <Button
          render={<Link to="/new-match/$playerId" params={{ playerId }} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          Start match
        </Button>
      </div>

      {/* Single page, real tabs (not a route per tab) — MatchPoint is a mobile-first,
          installed-PWA app used courtside, where deep-linking to one facet of a player
          record isn't the usual pattern the way it is on desktop dashboards. See #157/#158. */}
      <Tabs defaultValue="overview">
        {/* flex-none overrides TabsTrigger's default flex-1 (equal-width stretch) — with
            seven tabs that don't all fit, equal-width squeezing overflowed each label in
            both directions and clipped it unreadably. Sized-to-content triggers in a
            genuinely horizontally-scrollable row is what the wireframe's pill row means. */}
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview" className="flex-none">
            Overview
          </TabsTrigger>
          <TabsTrigger value="serve" className="flex-none">
            Serve
          </TabsTrigger>
          <TabsTrigger value="rally" className="flex-none">
            Rally
          </TabsTrigger>
          <TabsTrigger value="matches" className="flex-none">
            Matches
          </TabsTrigger>
          <TabsTrigger value="trends" className="flex-none">
            Trends
          </TabsTrigger>
          <TabsTrigger value="h2h" className="flex-none">
            H2H
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex-none">
            Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <dl>
            <dt>Date of birth</dt>
            <dd>{player.date_of_birth ?? "—"}</dd>
            <dt>Dominant hand</dt>
            <dd>{player.dominant_hand ?? "—"}</dd>
            <dt>Notes</dt>
            <dd>{player.notes ?? "—"}</dd>
          </dl>
          <p>{`Matches: ${matches?.length ?? "…"}`}</p>
        </TabsContent>

        <TabsContent value="serve" className="mt-4">
          <p className="text-muted-foreground">{`Serve — ${playerName}, coming soon.`}</p>
        </TabsContent>
        <TabsContent value="rally" className="mt-4">
          <p className="text-muted-foreground">{`Rally — ${playerName}, coming soon.`}</p>
        </TabsContent>
        <TabsContent value="matches" className="mt-4">
          <p className="text-muted-foreground">{`Matches — ${playerName}, coming soon.`}</p>
        </TabsContent>
        <TabsContent value="trends" className="mt-4">
          <p className="text-muted-foreground">{`Trends — ${playerName}, coming soon.`}</p>
        </TabsContent>
        <TabsContent value="notes" className="mt-4">
          <p className="text-muted-foreground">{`Notes — ${playerName}, coming soon.`}</p>
        </TabsContent>

        <TabsContent value="h2h" className="mt-4">
          <H2hPanel matches={matches ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function H2hPanel({ matches }: { matches: { opponent_name: string | null }[] }) {
  const [selectedOpponent, setSelectedOpponent] = useState<string | null>(null);

  // Real opponent names and meeting counts, derived from this player's own match
  // history (already fetched above) — win rates, exploit/avoid callouts, etc. are
  // Statistics-and-Analytics work (#164), not built here.
  const meetingCounts = new Map<string, number>();
  for (const match of matches) {
    const opponent = match.opponent_name ?? "Unknown opponent";
    meetingCounts.set(opponent, (meetingCounts.get(opponent) ?? 0) + 1);
  }
  const opponents = [...meetingCounts.entries()];

  if (selectedOpponent) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelectedOpponent(null)}
          className="mb-3 text-sm text-primary underline underline-offset-4"
        >
          ← Back to opponents
        </button>
        <p className="text-muted-foreground">{`H2H detail vs ${selectedOpponent}, coming soon.`}</p>
      </div>
    );
  }

  if (opponents.length === 0) {
    return <p className="text-muted-foreground">No head-to-head history yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {opponents.map(([opponent, count]) => (
        <Card key={opponent}>
          <CardContent>
            <button
              type="button"
              onClick={() => setSelectedOpponent(opponent)}
              className="flex w-full items-center justify-between text-left"
            >
              <span>{opponent}</span>
              <span className="text-sm text-muted-foreground">{`${count} meeting${count === 1 ? "" : "s"}`}</span>
            </button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
