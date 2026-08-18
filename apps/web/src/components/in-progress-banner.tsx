import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Circle } from "lucide-react";

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { getInProgressMatchOptions } from "@/lib/analytics/analytics-options";

/**
 * The resume banner at the top of the home and match screens.
 *
 * Renders nothing until there's a match to resume, which today is always — capture
 * has no screen yet, so `useInProgressMatch` resolves to null by design. The banner
 * is wired now so that landing capture is the only change needed to light it up.
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
