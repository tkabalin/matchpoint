import { createFileRoute } from "@tanstack/react-router";

import { MatchesPage } from "@/features/matches/matches-page";

export const Route = createFileRoute("/_authenticated/matches")({
  component: MatchesPage,
});
