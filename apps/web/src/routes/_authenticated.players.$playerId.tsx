import { createFileRoute } from "@tanstack/react-router";

import { PlayerProfile } from "@/features/players/player-profile";
import { validateStatsFiltersSearch } from "@/lib/analytics/filter-options";

export const validateSearch = validateStatsFiltersSearch;

export const Route = createFileRoute("/_authenticated/players/$playerId")({
  component: PlayerProfile,
  validateSearch,
});
