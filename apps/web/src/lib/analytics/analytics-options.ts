import { queryOptions } from "@tanstack/react-query";

import {
  COACH_NOTES,
  HEAD_TO_HEAD,
  HEAD_TO_HEAD_DETAIL,
  PLAYER_OVERVIEW,
  RALLY_STATS,
  SERVE_STATS,
  trendStatsFor,
} from "./fixtures";
import type {
  AttentionFlag,
  CoachNote,
  HeadToHeadDetail,
  HeadToHeadSummary,
  InProgressMatch,
  PlayerOverview,
  RallyStats,
  ServeStats,
  TrendStats,
  TrendWindow,
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
export const getServeStatsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<ServeStats>(["analytics", "serve", options.path.player_id], SERVE_STATS);

// PLACEHOLDER: GET /players/{player_id}/analytics/rally
export const getRallyStatsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<RallyStats>(["analytics", "rally", options.path.player_id], RALLY_STATS);

// PLACEHOLDER: GET /players/{player_id}/analytics/trends?window=
export const getTrendStatsOptions = (options: {
  path: { player_id: string };
  query: { window: TrendWindow };
}) =>
  fixtureOptions<TrendStats>(
    ["analytics", "trends", options.path.player_id, options.query.window],
    trendStatsFor(options.query.window),
  );

// PLACEHOLDER: GET /players/{player_id}/analytics/head-to-head
export const listHeadToHeadOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<HeadToHeadSummary[]>(["analytics", "h2h", options.path.player_id], HEAD_TO_HEAD);

// PLACEHOLDER: GET /players/{player_id}/analytics/head-to-head/{opponent_id}
export const getHeadToHeadOptions = (options: {
  path: { player_id: string; opponent_id: string };
}) => {
  const summary = HEAD_TO_HEAD.find((entry) => entry.opponentId === options.path.opponent_id);
  return fixtureOptions<HeadToHeadDetail>(
    ["analytics", "h2h", options.path.player_id, options.path.opponent_id],
    { ...HEAD_TO_HEAD_DETAIL, ...summary },
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
