import type { PlayerRead } from "@matchpoint/api-client";
import {
  listPlayersOptions,
  listSquadMemberStatsOptions,
} from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { PlayerAvatar } from "@/components/player-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { attentionFor } from "@/lib/analytics/attention";
import { getPlayerOverviewOptions } from "@/lib/analytics/analytics-options";
import { getErrorStatus } from "@/lib/error-status";

/**
 * The roster, read through the generated client, grouped by surname initial.
 *
 * Rows carry a one-line status because the roster is where a coach starts: the
 * point of the screen is spotting who needs attention without opening anyone.
 */
export function PlayerList({
  search,
  onSelect,
}: {
  search: string;
  onSelect: (player: PlayerRead) => void;
}) {
  const { data, isPending, isError, error } = useQuery(listPlayersOptions());

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
            <PlayerRow key={player.id} player={player} onSelect={onSelect} />
          ))}
        </section>
      ))}
    </div>
  );
}

function PlayerRow({
  player,
  onSelect,
}: {
  player: PlayerRead;
  onSelect: (player: PlayerRead) => void;
}) {
  const { data: overview } = useQuery(getPlayerOverviewOptions({ path: { player_id: player.id } }));
  // Same query the squad snapshot reads (home.tsx) — same queryKey, so this
  // doesn't add a second request, just a second reader of the cached one.
  const { data: squadStats } = useQuery(listSquadMemberStatsOptions());
  const member = squadStats?.find((entry) => entry.player_id === player.id);
  const flag = member ? attentionFor(member)?.reason : undefined;

  return (
    <Item
      variant="outline"
      render={<button type="button" onClick={() => onSelect(player)} />}
      className="w-full text-left"
    >
      <ItemMedia>
        <PlayerAvatar player={player} size="md" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2">
          {`${player.first_name} ${player.last_name}`}
          {/* Non-interactive — the whole row is already a button, so a live transfer
              code is a badge here, not a control. #185 owns cancelling it, from the
              player's profile. */}
          {player.has_transfer_code && <Badge variant="secondary">Transfer pending</Badge>}
        </ItemTitle>
        <ItemDescription className={flag ? "text-outcome-unforced" : undefined}>
          {flag ?? `Form ${overview?.form.value ?? "—"}%`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <ChevronRight className="size-4 text-muted-foreground" />
      </ItemActions>
    </Item>
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
