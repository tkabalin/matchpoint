import { queryOptions } from "@tanstack/react-query";

import { COACH_NOTES, OPPONENTS } from "./fixtures";
import type { CoachNote, InProgressMatch, OpponentOption } from "./types.provisional";

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

// PLACEHOLDER: GET /players/{player_id}/analytics/opponents — feeds the Serve/Rally
// scope panel's "vs opponent" picker. The player overview, serve, rally and
// per-match equivalents all read the real endpoints directly now
// (`@matchpoint/api-client/react-query`) — this one stays a fixture until
// #244's real dropdown lands, since its ids don't match the real
// `opponent_key` those endpoints expect.
export const listOpponentsOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<OpponentOption[]>(["analytics", "opponents", options.path.player_id], OPPONENTS);

// PLACEHOLDER: GET /players/{player_id}/notes
export const listCoachNotesOptions = (options: { path: { player_id: string } }) =>
  fixtureOptions<CoachNote[]>(["notes", options.path.player_id], COACH_NOTES);

/**
 * PLACEHOLDER: GET /matches?status=in_progress
 *
 * Resolves to null rather than a fixture match, which would offer to resume something
 * that isn't there. The device's own answer already exists — `listInProgress` in
 * `features/outbox/match-log.ts` — and swapping this for it is #229.
 */
export const getInProgressMatchOptions = () =>
  fixtureOptions<InProgressMatch | null>(["matches", "in-progress"], null);

/**
 * The squad snapshot (home) and the Squad stats page both read
 * `listSquadMemberStatsOptions` and `getSquadTrendOptions` straight from
 * `@matchpoint/api-client/react-query` now — real endpoints, not a
 * placeholder here. Nothing left in this file backs either screen.
 */
