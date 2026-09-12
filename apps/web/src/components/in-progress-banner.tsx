import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Circle } from "lucide-react";

import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { useInProgressSummary } from "@/features/capture/resume";
import { getRecordedOwner } from "@/lib/local-data";
import { relativeTimeFrom } from "@/lib/relative-time";

/**
 * The resume banner at the top of the home and match screens.
 *
 * Reads the device's own outbox (`useInProgressSummary`, #251) rather than a server
 * endpoint: capture is offline-first, and a server-driven banner would be dark exactly
 * when it's needed, at the court with no connection. The coach id comes off
 * `getRecordedOwner()`, not a `/coaches/me` query, for the same reason `new-match.tsx`
 * reads it that way: the route guard renders through on an unreachable network, so a
 * coach offline with no cached profile must not black out the one thing capture left
 * behind for them.
 */
export function InProgressBanner() {
  const summary = useInProgressSummary(getRecordedOwner());
  // No error branch, matching home.tsx's own lastViewedPlayer lookup: a player this
  // device can no longer read (deleted, transferred away) should quietly fall back to
  // a generic title rather than put a "not found" over a screen nobody asked to see.
  const { data: player } = useQuery({
    ...getPlayerOptions({ path: { player_id: summary?.trackedPlayerId ?? "" } }),
    enabled: summary !== null,
  });

  if (summary === null) return null;

  const title = player ? `${player.first_name} ${player.last_name}` : "Match in progress";

  return (
    <Item
      variant="outline"
      className="border-primary bg-primary/5"
      render={<Link to="/new-match/$playerId" params={{ playerId: summary.trackedPlayerId }} />}
    >
      <ItemMedia>
        <Circle className="size-3 fill-primary text-primary" aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-primary">{title}</ItemTitle>
        <ItemDescription>
          {`${summary.scoreLine} · ${relativeTimeFrom(summary.updatedAt)}`}
        </ItemDescription>
      </ItemContent>
      <span className="text-xs font-semibold text-primary">Resume →</span>
    </Item>
  );
}
