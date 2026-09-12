import type { Surface } from "@matchpoint/api-client";
import type { SearchSchemaInput } from "@tanstack/react-router";

import { SURFACE_LABEL } from "@/lib/tennis-labels";

import type {
  MatchScope,
  PhaseFilter,
  SetFilter,
  StatsFilters,
  SurfaceFilter,
} from "./types.provisional";

/** `"all"` is the scope panel's own sentinel and never reaches the wire — the
 *  endpoint takes `set_number` as an integer or an omitted/null parameter for
 *  "every set". Shared by the Serve and Rally tabs, both player- and
 *  match-scoped. */
export function toSetNumber(set: SetFilter): number | null {
  return set === "all" ? null : Number(set);
}

/** Shared option lists/labels for the scope filter — the player stats page's
 *  full scope panel and the per-match stats page's smaller Set/Phase-only
 *  panel both need these. */

export const SCOPE_OPTIONS: { value: MatchScope; label: string }[] = [
  { value: "all", label: "All matches" },
  { value: "vs-opponent", label: "vs opponent" },
];

export const SET_OPTIONS: { value: SetFilter; label: string }[] = [
  { value: "all", label: "All sets" },
  { value: "1", label: "Set 1" },
  { value: "2", label: "Set 2" },
  { value: "3", label: "Set 3" },
];

export const PHASE_OPTIONS: { value: PhaseFilter; label: string }[] = [
  { value: "full", label: "Full match" },
  { value: "tiebreaks", label: "Tiebreaks" },
  { value: "break_points", label: "Break points" },
  { value: "game_points", label: "Game points" },
  { value: "set_points", label: "Set points" },
  { value: "match_points", label: "Match points" },
  { value: "game_ending", label: "Game-ending" },
  { value: "set_ending", label: "Set-ending" },
];

export const SET_LABEL: Record<SetFilter, string> = Object.fromEntries(
  SET_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SetFilter, string>;

export const PHASE_LABEL: Record<PhaseFilter, string> = Object.fromEntries(
  PHASE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PhaseFilter, string>;

// Not a static options list like the two above: which surfaces are worth offering
// depends on which ones a given player actually has matches on (#225), so the real
// chip options are built at render time in stats-scope-panel.tsx. This is only the
// closed set the player route's own `validateSearch` checks incoming values
// against — every surface the enum has, plus the panel's own "all" sentinel.
export const SURFACE_VALUES = Object.keys(SURFACE_LABEL) as Surface[];
export const SURFACE_FILTER_VALUES: SurfaceFilter[] = ["all", ...SURFACE_VALUES];

const SCOPE_VALUES = SCOPE_OPTIONS.map((option) => option.value);
const SET_VALUES = SET_OPTIONS.map((option) => option.value);
const PHASE_VALUES = PHASE_OPTIONS.map((option) => option.value);

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * The Serve/Rally scope panel's committed filters, round-tripped through the URL so
 * they survive navigation and reload and can be shared/bookmarked — `.claude/rules/
 * web.md` names TanStack Router's typed search params as the intended home for exactly
 * this kind of state. Shared by the coach's `/players/$playerId` route and the
 * player's own `/me` route, both of which mount the same Serve/Rally scope panel.
 */
export function validateStatsFiltersSearch(
  search: Partial<StatsFilters> & SearchSchemaInput,
): StatsFilters {
  const scope = isOneOf(SCOPE_VALUES, search.scope) ? search.scope : "all";
  const opponentKey = typeof search.opponentKey === "string" ? search.opponentKey : null;
  return {
    scope,
    // A stray `opponentKey` with `scope=all` shouldn't survive a round trip — it
    // would silently re-narrow the tabs the next time scope switched back.
    opponentKey: scope === "vs-opponent" ? opponentKey : null,
    set: isOneOf(SET_VALUES, search.set) ? search.set : "all",
    phase: isOneOf(PHASE_VALUES, search.phase) ? search.phase : "full",
    surface: isOneOf(SURFACE_FILTER_VALUES, search.surface) ? search.surface : "all",
  };
}
