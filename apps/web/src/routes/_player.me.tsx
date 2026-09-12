import { createFileRoute } from "@tanstack/react-router";

import { PlayerSelfView } from "@/features/players/player-self-view";
import { validateStatsFiltersSearch } from "@/lib/analytics/filter-options";

export const validateSearch = validateStatsFiltersSearch;

export const Route = createFileRoute("/_player/me")({
  component: PlayerSelfView,
  validateSearch,
});
