import type { MatchRead, Surface } from "@matchpoint/api-client";

// Split out of match-filter-panel.tsx: a file exporting a component may not
// also export types/functions (react-refresh/only-export-components) — see
// nav-tabs.ts for the same split for the same reason.

export type ResultFilter = "all" | "win" | "loss" | "unfinished";
export type SurfaceFilter = "all" | Surface;
export type PlayerFilter = "all" | string;

export interface MatchFilters {
  from: string;
  to: string;
  opponent: string;
  surface: SurfaceFilter;
  result: ResultFilter;
  player: PlayerFilter;
}

export const DEFAULT_FILTERS: MatchFilters = {
  from: "",
  to: "",
  opponent: "",
  surface: "all",
  result: "all",
  player: "all",
};

export const RESULT_LABEL: Record<ResultFilter, string> = {
  all: "Any result",
  win: "Wins",
  loss: "Losses",
  unfinished: "Unfinished",
};

export function matchesFilters(match: MatchRead, filters: MatchFilters): boolean {
  if (filters.from && match.played_on < filters.from) return false;
  if (filters.to && match.played_on > filters.to) return false;
  if (
    filters.opponent.trim() &&
    !(match.opponent_name ?? "").toLowerCase().includes(filters.opponent.trim().toLowerCase())
  ) {
    return false;
  }
  if (filters.surface !== "all" && match.surface !== filters.surface) return false;
  if (filters.result === "win" && match.result !== "win") return false;
  if (filters.result === "loss" && match.result !== "loss") return false;
  if (filters.result === "unfinished" && match.result !== null) return false;
  if (filters.player !== "all" && match.player_id !== filters.player) return false;
  return true;
}

export function isActive(filters: MatchFilters): boolean {
  return (
    filters.from !== "" ||
    filters.to !== "" ||
    filters.opponent.trim() !== "" ||
    filters.surface !== "all" ||
    filters.result !== "all" ||
    filters.player !== "all"
  );
}
