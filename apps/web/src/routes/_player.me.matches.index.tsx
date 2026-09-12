import { createFileRoute } from "@tanstack/react-router";

import { PlayerMatchesPage } from "@/features/matches/player-matches-page";

export const Route = createFileRoute("/_player/me/matches/")({
  component: PlayerMatchesPage,
});
