import { queryOptions } from "@tanstack/react-query";

import {
  COACH_NOTES,
  OPPONENTS,
  PLAYER_OVERVIEW,
  RALLY_STATS,
  RECENT_FORM,
  SERVE_STATS,
} from "./fixtures";
import type {
  AttentionFlag,
  CoachNote,
  InProgressMatch,
  OpponentOption,
  PlayerOverview,
  RallyStats,
  RecentForm,
  ServeStats,
} from "./types.provisional";

/**
 * Query options for the analytics the API doesn't serve yet.
 *
 * Deliberately shaped like `@matchpoint/api-client/react-query`'s generated
 * factories — a `*Options` function taking `{ path }`/`{ query }` and returning
 * `queryOptions`, handed to `useQuery` at the call site — so the eventual swap is a
 * changed import and name at each call site, not a rewrite of the components.
 *
 * The names here are a guess: the generated ones come from each route's operation
 * id, which won't exist until the endpoints are written. The call shape is what's
 * being pinned, not the identifier.
 *
 * These live in `lib/` rather than a feature slice because home, players and
 * matches all read them, and `.claude/rules/web.md` puts anything shared between
 * slices here rather than letting one slice import another.
 */

function fixtureOptions<T>(key: unknown[], value: T) {
  return queryOptions({ queryKey: key, queryFn: () => Promise.resolve(value) });
}

// PLACEHOLDER: GET /players/{player_id}/analytics/overview
export const getPlayerOverviewOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<PlayerOverview>(
    ["analytics", "overview", options.path.player_id],
    PLAYER_OVERVIEW,
  );

// PLACEHOLDER: GET /players/{player_id}/analytics/serve
//
// "v2" isn't a real API version — it's here so a browser that persisted the old
// `ServeStats` shape (pre-scope-panel redesign) to IndexedDB can't hand that stale
// shape back under this query key and crash the new component reading fields that
// didn't exist on it. Bump it again the next time this fixture's shape changes.
export const getServeStatsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<ServeStats>(["analytics", "serve", "v2", options.path.player_id], SERVE_STATS);

// PLACEHOLDER: GET /players/{player_id}/analytics/rally — see getServeStatsOptions'
// own comment on why this carries a version segment.
export const getRallyStatsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<RallyStats>(["analytics", "rally", "v2", options.path.player_id], RALLY_STATS);

// PLACEHOLDER: GET /players/{player_id}/analytics/opponents — feeds the Serve/Rally
// scope panel's "vs opponent" picker.
export const listOpponentsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<OpponentOption[]>(["analytics", "opponents", options.path.player_id], OPPONENTS);

// PLACEHOLDER: GET /players/{player_id}/analytics/recent-form?opponent_id= — the
// dot row above the Serve/Rally tabs, scoped to all matches or one opponent.
//
// Only `all` plus 3 of `OPPONENTS`' 12 entries have a fixture — `null`, not the
// all-matches fallback, for the other 9. `RecentFormRow` already treats a null
// result as "nothing to show" and renders nothing, which is honest; silently
// substituting the all-matches record under that opponent's name would not be.
export const getRecentFormOptions = (options: {
  path: { player_id: string };
  query: { opponentId: string | null };
}) => {
  const key = options.query.opponentId ?? "all";
  return fixtureOptions<RecentForm | null>(
    ["analytics", "recent-form", options.path.player_id, key],
    RECENT_FORM[key] ?? null,
  );
};

// PLACEHOLDER: GET /players/{player_id}/notes
export const listCoachNotesOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<CoachNote[]>(["notes", options.path.player_id], COACH_NOTES);

/**
 * PLACEHOLDER: GET /matches?status=in_progress
 *
 * Resolves to null rather than a fixture match: capture has no screen yet, so a
 * resume banner would offer to continue something that can't be continued.
 */
export const getInProgressMatchOptions = () =>
  fixtureOptions<InProgressMatch | null>(["matches", "in-progress"], null);

/**
 * PLACEHOLDER: GET /coaches/me/attention
 *
 * Empty, and not from a fixture. Every other placeholder here is a number a
 * reviewer reads as demo data; a flag is a sentence asserting that a named player
 * has a specific problem, which a coach could act on. That one waits for real
 * trend flagging (#158).
 */
export const listAttentionFlagsOptions = () => fixtureOptions<AttentionFlag[]>(["attention"], []);
