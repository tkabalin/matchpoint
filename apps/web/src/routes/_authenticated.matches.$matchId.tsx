import { createFileRoute } from "@tanstack/react-router";

import { MatchStatsPage } from "@/features/matches/match-stats-page";

export const Route = createFileRoute("/_authenticated/matches/$matchId")({
  component: MatchStatsPage,
});
