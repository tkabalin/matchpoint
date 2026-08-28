import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Circle } from "lucide-react";

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { getInProgressMatchOptions } from "@/lib/analytics/analytics-options";

/**
 * The resume banner at the top of the home and match screens.
 *
 * Still renders nothing: capture now leaves a real signal behind (`listInProgress` in
 * `features/outbox/match-log.ts` lists the coach's unfinished matches), but this reads
 * the fixture-backed placeholder, which resolves to null. Consuming the real signal
 * needs a roster lookup for the player's name and a route to resume into, which is
 * #229's own work.
 */
export function InProgressBanner() {
  const { data: match } = useQuery(getInProgressMatchOptions());

  if (!match) return null;

  return (
    <Item variant="outline" className="border-primary bg-primary/5" render={<Link to="/matches" />}>
      <ItemMedia>
        <Circle className="size-3 fill-primary text-primary" aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-primary">Match in progress</ItemTitle>
        <ItemDescription>
          {`${match.playerName} vs ${match.opponentName} · ${match.score} · ${match.elapsed}`}
        </ItemDescription>
      </ItemContent>
      <span className="text-xs font-semibold text-primary">Resume →</span>
    </Item>
  );
}
