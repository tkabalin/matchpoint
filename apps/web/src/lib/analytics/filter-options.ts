import type { MatchScope, PhaseFilter, SetFilter } from "./types.provisional";

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
