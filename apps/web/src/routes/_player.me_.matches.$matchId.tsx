import { createFileRoute } from "@tanstack/react-router";

import { PlayerMatchStatsPage } from "@/features/matches/player-match-stats-page";

export const Route = createFileRoute("/_player/me_/matches/$matchId")({
  component: PlayerMatchStatsPage,
});
