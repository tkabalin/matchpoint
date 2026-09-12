import { createFileRoute } from "@tanstack/react-router";

import { CoachMatchStatsPage } from "@/features/matches/coach-match-stats-page";

export const Route = createFileRoute("/_authenticated/matches/$matchId")({
  component: CoachMatchStatsPage,
});
