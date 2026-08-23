import type { MatchRead, MatchUpdate, ScoringSystem, Surface } from "@matchpoint/api-client";

export const MATCH_OPPONENT_MAX = 100;
export const MATCH_EVENT_MAX = 100;

export type SurfaceChoice = Surface | "";
export type ScoringSystemChoice = ScoringSystem | "";

export interface MatchFormValues {
  opponentName: string;
  playedOn: string;
  surface: SurfaceChoice;
  scoringSystem: ScoringSystemChoice;
  event: string;
}

/** The values an existing match's record maps to when opening it for editing. */
export function matchFormValuesFrom(match: MatchRead): MatchFormValues {
  return {
    opponentName: match.opponent_name ?? "",
    playedOn: match.played_on,
    surface: match.surface ?? "",
    scoringSystem: match.scoring_system ?? "",
    event: match.event ?? "",
  };
}

export function validateMatchForm(values: MatchFormValues) {
  const isValid = values.playedOn.trim() !== "";
  return { isValid };
}

/**
 * Diffs edited form values against the match's original record, so a save
 * only PATCHes what actually changed — same reasoning as
 * `buildPlayerUpdateBody`: `MatchUpdate` is a true partial, and resending
 * every field risks blowing away a concurrent edit.
 */
export function buildMatchUpdateBody(original: MatchRead, values: MatchFormValues): MatchUpdate {
  const body: MatchUpdate = {};

  const opponentName = values.opponentName.trim() === "" ? null : values.opponentName.trim();
  const event = values.event.trim() === "" ? null : values.event.trim();
  const surface = values.surface === "" ? null : values.surface;
  const scoringSystem = values.scoringSystem === "" ? null : values.scoringSystem;

  if (opponentName !== original.opponent_name) body.opponent_name = opponentName;
  if (values.playedOn !== original.played_on) body.played_on = values.playedOn;
  if (surface !== original.surface) body.surface = surface;
  if (scoringSystem !== original.scoring_system) body.scoring_system = scoringSystem;
  if (event !== original.event) body.event = event;

  return body;
}
