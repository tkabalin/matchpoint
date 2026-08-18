import type { MatchRead } from "@matchpoint/api-client";
import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";

import { OutcomeSwatch } from "@/components/outcome-swatch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

const SURFACE_LABEL: Record<string, string> = {
  hard: "Hard",
  clay: "Clay",
  grass: "Grass",
  carpet: "Carpet",
};

export function MatchList({ playerId }: { playerId?: string } = {}) {
  const { data, isPending, isError } = useQuery(
    listMatchesOptions(playerId ? { query: { player_id: playerId } } : undefined),
  );

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

  return (
    <div className="flex flex-col gap-2">
      {data.map((match) => (
        <MatchRow key={match.id} match={match} />
      ))}
    </div>
  );
}

function MatchRow({ match }: { match: MatchRead }) {
  const opponent = match.opponent_name ?? "Unknown opponent";
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
          // An unfinished match has no result to colour, and guessing one would
          // read as a loss.
          <span className="size-6 rounded-sm border border-dashed" aria-hidden="true" />
        )}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{`vs ${opponent}`}</ItemTitle>
        <ItemDescription>{detail}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

// `played_on` is a plain calendar date; `new Date(str)` would read it as UTC midnight
// and show the previous day east of UTC. See .claude/rules/web.md.
function formatPlayedOn(playedOn: string): string {
  const [year, month, day] = playedOn.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
