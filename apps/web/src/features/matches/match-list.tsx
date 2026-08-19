import type { MatchRead } from "@matchpoint/api-client";
import { listMatchesOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { OutcomeSwatch } from "@/components/outcome-swatch";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

import { SURFACE_LABEL, formatPlayedOn } from "./match-format";

export function MatchList({ onSelect }: { onSelect: (match: MatchRead) => void }) {
  const { data, isPending, isError } = useQuery(listMatchesOptions());

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
        <MatchRow key={match.id} match={match} onSelect={onSelect} />
      ))}
    </div>
  );
}

function MatchRow({ match, onSelect }: { match: MatchRead; onSelect: (match: MatchRead) => void }) {
  const opponent = match.opponent_name ?? "Unknown opponent";
  const detail = [formatPlayedOn(match.played_on), match.surface && SURFACE_LABEL[match.surface]]
    .filter(Boolean)
    .join(" · ");

  return (
    <Item
      variant="outline"
      render={<button type="button" onClick={() => onSelect(match)} />}
      className="w-full text-left"
    >
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
      <ItemActions>
        <ChevronRight className="size-4 text-muted-foreground" />
      </ItemActions>
    </Item>
  );
}
