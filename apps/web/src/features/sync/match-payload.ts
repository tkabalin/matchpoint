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

import type { MatchCreate, SetsFormat } from "@matchpoint/api-client";

import { maxSetsFor, type Match, type ScoringSystem } from "@/features/capture/match";

/**
 * Lossy, and only in this direction: several `ScoringSystem` members share a sets
 * count, so `best_of_3` does not name the one that produced it. Anything needing
 * the round trip has to carry `scoringSystem` itself, not recover it from here.
 */
function toSetsFormat(scoringSystem: ScoringSystem): SetsFormat {
  switch (maxSetsFor(scoringSystem)) {
    case 1:
      return "best_of_1";
    case 5:
      return "best_of_5";
    default:
      return "best_of_3";
  }
}

export function toMatchCreate(match: Match): MatchCreate {
  return {
    player_id: match.trackedPlayerId,
    played_on: match.playedOn,
    // "unspecified" is a real SurfaceType member (see match.ts); the backend has no
    // equivalent, so it maps to the same absence a coach who skipped the field gets.
    surface: match.surfaceType === "unspecified" ? null : match.surfaceType,
    sets_format: toSetsFormat(match.scoringSystem),
    opponent_name: match.opponentName,
    // No source to map from yet — Match has no event field.
    event: null,
  };
}
