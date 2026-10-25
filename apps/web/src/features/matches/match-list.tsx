import type { MatchRead } from "@matchpoint/api-client";
import { listMatchesOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

import { MatchFilterPanel } from "./match-filter-panel";
import { DEFAULT_FILTERS, matchesFilters } from "./match-filters";
import { MatchCard } from "./match-card";

export function MatchList({
  onEdit,
  onDelete,
}: {
  onEdit: (match: MatchRead) => void;
  onDelete: (match: MatchRead) => void;
}) {
  const { data, isPending, isError } = useQuery(listMatchesOptions());
  const { data: players } = useQuery(listPlayersOptions());
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const playersById = new Map((players ?? []).map((player) => [player.id, player]));

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
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load matches.</AlertDescription>
      </Alert>
    );
  }

  if (data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matches yet</EmptyTitle>
          <EmptyDescription>Matches you record will be listed here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const filtered = data.filter((match) => matchesFilters(match, filters));

  return (
    <div className="flex flex-col gap-2">
      <MatchFilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        players={players ?? []}
        filteredCount={filtered.length}
        totalCount={data.length}
      />

      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No matches match those filters.</p>
      ) : (
        filtered.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            player={playersById.get(match.player_id)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}
