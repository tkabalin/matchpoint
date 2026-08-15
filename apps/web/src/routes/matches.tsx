import { createFileRoute } from "@tanstack/react-router";

import { MatchesPage } from "@/features/matches/matches-page";

export const Route = createFileRoute("/matches")({
  component: MatchesPage,
});
