import { getRouteApi } from "@tanstack/react-router";

import { MatchStatsPage } from "./match-stats-page";

const routeApi = getRouteApi("/_authenticated/matches/$matchId");

/** The coach's own route-bound wrapper — see `player-match-stats-page.tsx` for why
 *  `MatchStatsPage` itself takes `matchId`/`backTo` as props rather than resolving
 *  them off a hardcoded route id (#203). */
export function CoachMatchStatsPage() {
  const { matchId } = routeApi.useParams();
  return <MatchStatsPage matchId={matchId} backTo="/matches" showPlayer />;
}
