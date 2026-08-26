/**
 * The boundary between the capture domain model and the API for a match's final
 * outcome — the sibling of match-payload.ts and point-payload.ts. Unlike those two,
 * the queued payload is not a capture domain object (there's no MatchOutcome class),
 * just `{reason, trackedPlayerWon}`, so this file validates the shape itself rather
 * than delegating to a `fromJSON`.
 *
 * `result` is the only field the API has for how a match ended: MatchResult is
 * win/loss from the tracked player's side, with no reason. `reason` is carried and
 * checked anyway, so a future field to hold it costs no re-plumbing here — see
 * docs/database-changes-needed.md.
 */

import type { MatchUpdate } from "@matchpoint/api-client";

import { MATCH_END_REASONS, type MatchEndReason } from "@/features/capture/match";

export function toMatchOutcomeUpdate(payload: unknown): MatchUpdate {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("match outcome payload must be an object");
  }
  const { reason, trackedPlayerWon } = payload as Record<string, unknown>;
  if (!MATCH_END_REASONS.includes(reason as MatchEndReason)) {
    throw new Error(`invalid match outcome reason: ${String(reason)}`);
  }
  if (typeof trackedPlayerWon !== "boolean") {
    throw new Error(`trackedPlayerWon must be a boolean, got: ${String(trackedPlayerWon)}`);
  }
  return { result: trackedPlayerWon ? "win" : "loss" };
}
