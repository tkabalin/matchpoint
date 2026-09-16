import { getRouteApi } from "@tanstack/react-router";

import { MatchStatsPage } from "./match-stats-page";

const routeApi = getRouteApi("/_player/me_/matches/$matchId");

/**
 * A player's own route-bound wrapper. `MatchStatsPage` mounts under two different
 * routes now — this one and `coach-match-stats-page.tsx`'s — so it takes `matchId`
 * and `backTo` as props rather than resolving them off a single hardcoded
 * `getRouteApi` id the way it used to (#203).
 */
export function PlayerMatchStatsPage() {
  const { matchId } = routeApi.useParams();
  return <MatchStatsPage matchId={matchId} backTo="/me/matches" />;
}
