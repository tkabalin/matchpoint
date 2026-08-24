import { queryOptions } from "@tanstack/react-query";

import {
  COACH_NOTES,
  OPPONENTS,
  PLAYER_OVERVIEW,
  RECENT_FORM,
  rallyStatsFor,
  serveStatsFor,
  squadMemberStatsFor,
  squadStatsFor,
  squadTrendFor,
} from "./fixtures";
import type {
  AttentionFlag,
  CoachNote,
  InProgressMatch,
  OpponentOption,
  PhaseFilter,
  PlayerOverview,
  RallyStats,
  RecentForm,
  ServeStats,
  SetFilter,
  SquadMetricKey,
  SquadTrendPoint,
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

// PLACEHOLDER: GET /players/{player_id}/analytics/serve?set=&phase= — no real
// set/phase bucketing exists yet (see the GitLab issue filed against this
// gap), so the query key carries them and `serveStatsFor` picks a
// deterministically-scaled fixture variant instead of the one static object
// every selection used to render regardless of what was picked.
//
// "v3" isn't a real API version — it's here so a browser that persisted an older
// `ServeStats` shape to IndexedDB can't hand that stale shape back under this
// query key and crash the new component reading fields that didn't exist on it.
// Bumped from v2 when `outcome` split into firstServe/secondServe (a coach on
// the 2nd-serve toggle used to read `stats.outcome.firstServe.in` — undefined
// under the old flat `{in, fault, ace}` shape, a `Cannot read properties of
// undefined` crash). Bump it again the next time this fixture's shape changes.
export const getServeStatsOptions = (options: {
  path: { player_id: string };
  query?: { set?: SetFilter; phase?: PhaseFilter; opponentId?: string | null };
}) => {
  const set = options.query?.set ?? "all";
  const phase = options.query?.phase ?? "full";
  const opponentId = options.query?.opponentId ?? null;
  return fixtureOptions<ServeStats>(
    ["analytics", "serve", "v3", options.path.player_id, set, phase, opponentId ?? "all"],
    serveStatsFor({ set, phase, opponentId }),
  );
};

// PLACEHOLDER: GET /players/{player_id}/analytics/rally?set=&phase= — see
// getServeStatsOptions' own comment on both the version segment and the
// set/phase scaling.
export const getRallyStatsOptions = (options: {
  path: { player_id: string };
  query?: { set?: SetFilter; phase?: PhaseFilter; opponentId?: string | null };
}) => {
  const set = options.query?.set ?? "all";
  const phase = options.query?.phase ?? "full";
  const opponentId = options.query?.opponentId ?? null;
  return fixtureOptions<RallyStats>(
    ["analytics", "rally", "v3", options.path.player_id, set, phase, opponentId ?? "all"],
    rallyStatsFor({ set, phase, opponentId }),
  );
};

// PLACEHOLDER: GET /matches/{match_id}/analytics/serve?set=&phase= — the
// per-match stats page's Serve tab (#199/#213 follow-up). `matchWeight` is a
// fixed "this one match looked a bit different" shift, composed with the
// page's own set/phase selection the same way the player-wide endpoint does.
const MATCH_SERVE_WEIGHT = [0.9, 1.25, 1.1] as const;
export const getMatchServeStatsOptions = (options: {
  path: { match_id: string };
  query?: { set?: SetFilter; phase?: PhaseFilter };
}) => {
  const set = options.query?.set ?? "all";
  const phase = options.query?.phase ?? "full";
  return fixtureOptions<ServeStats>(
    ["analytics", "match-serve", options.path.match_id, set, phase],
    serveStatsFor({ set, phase, matchWeight: MATCH_SERVE_WEIGHT }),
  );
};

// PLACEHOLDER: GET /matches/{match_id}/analytics/rally?set=&phase= — see
// getMatchServeStatsOptions' own comment.
const MATCH_RALLY_SCALE = 0.16;
export const getMatchRallyStatsOptions = (options: {
  path: { match_id: string };
  query?: { set?: SetFilter; phase?: PhaseFilter };
}) => {
  const set = options.query?.set ?? "all";
  const phase = options.query?.phase ?? "full";
  return fixtureOptions<RallyStats>(
    ["analytics", "match-rally", options.path.match_id, set, phase],
    rallyStatsFor({ set, phase, scale: MATCH_RALLY_SCALE }),
  );
};

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

/**
 * PLACEHOLDER standing in for a real endpoint: `GET /squad/analytics/members`
 * (generated as `listSquadMemberStatsOptions`) computes each player's rolling
 * stats and streaks server-side, and `squadMemberStatsFor` keeps synthesizing
 * them from hand-authored fixture profiles (see `fixtures.ts`) until the call
 * sites are swapped over. Synchronous, not `queryOptions`: it derives from the
 * roster the caller already has loaded, with nothing of its own to fetch.
 */
export { squadMemberStatsFor };

/**
 * PLACEHOLDER for the Squad stats page's own per-player fixture: same
 * reasoning as `squadMemberStatsFor` above, and the same endpoint behind it.
 * `GET /squad/analytics/members` carries the leaderboard's `period_record` and
 * `first_serve_in_percent` beside the snapshot's own figures rather than
 * splitting one roster read across two routes. Both of those rates are nullable
 * there where `SquadStatsEntry` types them as plain numbers, so the swap has to
 * say what a player with no ratio yet ranks as.
 */
export { squadStatsFor };

// PLACEHOLDER: the Squad stats page's trend card, one roster-wide figure a week
// over the last 6 weeks. `GET /squad/analytics/trend?metric=` serves it, pooling
// each week's matches rather than averaging the roster, and its `value` is null
// in a week the roster cannot answer where this fixture's is always a number.
// Its metric values are `record`, `forced_to_unforced` and `first_serve_in`, so
// wiring this up maps `SquadMetricKey` onto those and replaces this export with
// the generated `getSquadTrendOptions`. No version segment: unlike
// `getServeStatsOptions`, this key has no prior persisted shape to collide with.
export const getSquadTrendOptions = (options: { query: { metric: SquadMetricKey } }) =>
  fixtureOptions<SquadTrendPoint[]>(
    ["analytics", "squad-trend", options.query.metric],
    squadTrendFor(options.query.metric),
  );
