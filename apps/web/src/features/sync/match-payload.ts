/**
 * The boundary between the capture domain model and the API.
 *
 * `Match` is the offline capture model, shaped for scoring; `MatchCreate` is the
 * wire contract, generated from the API's OpenAPI spec. They are not the same shape
 * and shouldn't be, so the translation lives here rather than being inlined at a
 * call site. Annotating the return type is what makes a backend field change a
 * compile error in this app: see "Contract checks against the API" in docs/testing.md.
 *
 * In sync/ rather than capture/ because it names the API client, which the capture
 * path may not (see .claude/rules/web-capture.md). Sync rehydrates an outbox record
 * with `Match.fromJSON` and maps the result.
 */

import type { MatchCreate } from "@matchpoint/api-client";

import type { Match } from "@/features/capture/match";

export function toMatchCreate(match: Match): MatchCreate {
  return {
    player_id: match.trackedPlayerId,
    played_on: match.playedOn,
    // "unspecified" is a real SurfaceType member (see match.ts); the backend has no
    // equivalent, so it maps to the same absence a coach who skipped the field gets.
    surface: match.surfaceType === "unspecified" ? null : match.surfaceType,
    // The API's ScoringSystem enum holds exactly the members of the capture model's
    // union (#154), so this passes through. A member added here that the API lacks
    // stops compiling; one added only on the API side is nothing this file can see.
    scoring_system: match.scoringSystem,
    opponent_name: match.opponentName,
    // No source to map from yet — Match has no event field.
    event: null,
  };
}
