import type { PlayerRead } from "@matchpoint/api-client";
import {
  listPlayersOptions,
  listSquadMemberStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PlayerCard } from "@/components/player-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorStatus } from "@/lib/error-status";

/**
 * The roster, read through the generated client, grouped by surname initial.
 *
 * Each card carries its own stats because the roster is where a coach starts: the
 * point of the screen is spotting who needs attention and acting on it, without a
 * detour through a picker sheet first.
 */
export function PlayerList({ search }: { search: string }) {
  const { data, isPending, isError, error } = useQuery(listPlayersOptions());
  // Same query the squad snapshot reads (home.tsx) — same queryKey, so every
  // card reads this once cached rather than each firing its own request.
  const { data: squadStats } = useQuery(listSquadMemberStatsOptions());

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    // A session that died mid-visit (background refetch hits a 401) looks nothing
    // like a real failure to load — send the coach back to sign in instead of the
    // generic message, which would read as a bug rather than an expired session.
    if (getErrorStatus(error) === 401) {
      return (
        <Alert variant="destructive">
          <AlertDescription>
            Your session has expired. <Link to="/">Sign in</Link> to see your players.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load players.</AlertDescription>
      </Alert>
    );
  }

  const term = search.trim().toLowerCase();
  const matching = data.filter((player) =>
    `${player.first_name} ${player.last_name}`.toLowerCase().includes(term),
  );

  if (data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No players yet</EmptyTitle>
          <EmptyDescription>Add your first player to start tracking matches.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (matching.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No players found</EmptyTitle>
          <EmptyDescription>{`Nothing matches “${search}”.`}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const groups = groupByInitial(matching);

  return (
    <div className="flex flex-col gap-3">
      {groups.map(([initial, players]) => (
        <section key={initial} className="flex flex-col gap-2">
          <h2 className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
            {initial}
          </h2>
          {players.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              member={squadStats?.find((entry) => entry.player_id === player.id)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function groupByInitial(players: PlayerRead[]): [string, PlayerRead[]][] {
  const groups = new Map<string, PlayerRead[]>();
  for (const player of [...players].sort((a, b) => a.last_name.localeCompare(b.last_name))) {
    const initial = player.last_name[0]?.toUpperCase() ?? "#";
    groups.set(initial, [...(groups.get(initial) ?? []), player]);
  }
  return [...groups.entries()];
}
