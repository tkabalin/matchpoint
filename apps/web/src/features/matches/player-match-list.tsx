import { getCurrentPlayerOptions, listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

import { MatchFilterPanel } from "./match-filter-panel";
import { DEFAULT_FILTERS, matchesFilters } from "./match-filters";
import { MatchCard } from "./match-card";

/**
 * A player's own matches list — `MatchList` minus everything coach-only: no
 * `listPlayersOptions` name lookup (it's always them), no Player select in
 * the filter panel (passing no `players` prop to `MatchFilterPanel` is what
 * leaves that one row out — the From/To/opponent/surface/result filters
 * underneath are the same shared panel the coach's own list uses, not a
 * second copy (#300)), no Edit/Delete (both mutations are coach-only).
 * `listMatchesOptions` needs no `player_id` query param here either — the
 * server already scopes a player principal's own `GET /matches` to their
 * own rows.
 */
export function PlayerMatchList() {
  const { data: player } = useQuery(getCurrentPlayerOptions());
  const { data: matches, isPending, isError } = useQuery(listMatchesOptions());
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

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

  const filtered = matches.filter((match) => matchesFilters(match, filters));

  return (
    <div className="flex flex-col gap-2">
      <MatchFilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        filteredCount={filtered.length}
        totalCount={matches.length}
      />

      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No matches match those filters.</p>
      ) : (
        filtered.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            player={player}
            matchHref="/me/matches/$matchId"
          />
        ))
      )}
    </div>
  );
}
