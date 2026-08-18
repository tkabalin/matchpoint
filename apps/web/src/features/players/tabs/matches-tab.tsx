import type { MatchRead } from "@matchpoint/api-client";
import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { OutcomeSwatch } from "@/components/outcome-swatch";
import { SegmentedControl } from "@/components/segmented-control";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

type Filter = "all" | "wins" | "losses";

const SURFACE_LABEL: Record<string, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  carpet: "Carpet",
};

/**
 * This player's match history — real data, unlike its sibling tabs: matches are one
 * of the endpoints that already exists.
 */
export function MatchesTab({ playerId }: { playerId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isPending } = useQuery(listMatchesOptions({ query: { player_id: playerId } }));

  if (isPending) return <Skeleton className="h-64 w-full" />;

  const matches = (data ?? []).filter((match) =>
    filter === "all" ? true : filter === "wins" ? match.result === "win" : match.result === "loss",
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Filtering by opponent and surface is in the wireframe but needs a picker
          per distinct value; result is the one that's a fixed, known set. */}
      <SegmentedControl
        aria-label="Filter matches"
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "wins", label: "Wins" },
          { value: "losses", label: "Losses" },
        ]}
      />

      {matches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              {filter === "all"
                ? "Matches you record for this player will show up here."
                : "Nothing recorded with that result yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        matches.map((match) => <MatchRow key={match.id} match={match} />)
      )}

      <p className="text-center text-[0.625rem] text-muted-foreground">
        Per-set splits and a point-by-point timeline arrive with match capture.
      </p>
    </div>
  );
}

function MatchRow({ match }: { match: MatchRead }) {
  const detail = [formatPlayedOn(match.played_on), match.surface && SURFACE_LABEL[match.surface]]
    .filter(Boolean)
    .join(" · ");

  return (
    <Item variant="outline">
      <ItemMedia>
        {match.result ? (
          <OutcomeSwatch
            pattern={match.result === "win" ? "win" : "unforced"}
            label={match.result === "win" ? "W" : "L"}
            size="lg"
          />
        ) : (
          <span className="size-6 rounded-sm border border-dashed" aria-hidden="true" />
        )}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{`vs ${match.opponent_name ?? "Unknown opponent"}`}</ItemTitle>
        <ItemDescription>{detail}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

// `played_on` is a plain calendar date; see .claude/rules/web.md.
function formatPlayedOn(playedOn: string): string {
  const [year, month, day] = playedOn.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
