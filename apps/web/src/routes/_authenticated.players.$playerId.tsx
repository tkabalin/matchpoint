import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";

import { PlayerProfile } from "@/features/players/player-profile";
import {
  PHASE_OPTIONS,
  SCOPE_OPTIONS,
  SET_OPTIONS,
  SURFACE_FILTER_VALUES,
} from "@/lib/analytics/filter-options";
import type { StatsFilters } from "@/lib/analytics/types.provisional";

const SCOPE_VALUES = SCOPE_OPTIONS.map((option) => option.value);
const SET_VALUES = SET_OPTIONS.map((option) => option.value);
const PHASE_VALUES = PHASE_OPTIONS.map((option) => option.value);

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * The Serve/Rally scope panel's committed filters, round-tripped through the
 * URL so they survive navigation and reload and can be shared/bookmarked —
 * `.claude/rules/web.md` names TanStack Router's typed search params as the
 * intended home for exactly this kind of state.
 */
export function validateSearch(search: Partial<StatsFilters> & SearchSchemaInput): StatsFilters {
  const scope = isOneOf(SCOPE_VALUES, search.scope) ? search.scope : "all";
  const opponentKey = typeof search.opponentKey === "string" ? search.opponentKey : null;
  return {
    scope,
    // A stray `opponentKey` with `scope=all` shouldn't survive a round trip —
    // it would silently re-narrow the tabs the next time scope switched back.
    opponentKey: scope === "vs-opponent" ? opponentKey : null,
    set: isOneOf(SET_VALUES, search.set) ? search.set : "all",
    phase: isOneOf(PHASE_VALUES, search.phase) ? search.phase : "full",
    surface: isOneOf(SURFACE_FILTER_VALUES, search.surface) ? search.surface : "all",
  };
}

export const Route = createFileRoute("/_authenticated/players/$playerId")({
  component: PlayerProfile,
  validateSearch,
});
