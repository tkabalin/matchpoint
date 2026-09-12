import { getCurrentPlayerOptions, listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

import { MatchRow } from "./match-list";

/**
 * A player's own matches list — `MatchList` minus everything coach-only: no
 * `listPlayersOptions` name lookup (it's always them), no player/date/opponent/
 * result filter panel (a coach's roster-wide problem, not a player's), no
 * Edit/Delete (both mutations are coach-only). `listMatchesOptions` needs no
 * `player_id` query param here either — the server already scopes a player
 * principal's own `GET /matches` to their own rows.
 */
export function PlayerMatchList() {
  const { data: player } = useQuery(getCurrentPlayerOptions());
  const { data: matches, isPending, isError } = useQuery(listMatchesOptions());

  if (isPending || !player) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load matches.</AlertDescription>
      </Alert>
    );
  }

  if (matches.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matches yet</EmptyTitle>
          <EmptyDescription>Matches your coach records will be listed here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {matches.map((match) => (
        <MatchRow key={match.id} match={match} player={player} />
      ))}
    </div>
  );
}
