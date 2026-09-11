import type { Surface } from "@matchpoint/api-client";

/**
 * Provisional shapes for analytics the API doesn't serve yet.
 *
 * Everything here is modelled as the generated DTO would be — numbers and units,
 * not display strings — so that when the endpoints land, only the hook bodies in
 * `analytics-options.ts` change and no component has to be touched.
 *
 * These live in `lib/` rather than a feature slice because home, players and
 * matches all read them, and `.claude/rules/web.md` puts anything shared between
 * slices here rather than letting one slice import another.
 */

export type MatchOutcome = "win" | "loss";

export interface WinLossRecord {
  wins: number;
  losses: number;
}

/**
 * Scope/filter state for the Serve and Rally tabs' scope panel. UI state
 * only — no fixture yet varies by set/phase, so this is what a coach has picked
 * and what the scope bar echoes back, not a query parameter. Recent form (below)
 * is the one exception: it does vary by scope, since it's the one piece the
 * mockup itself shows changing on Apply.
 */
export type MatchScope = "all" | "vs-opponent";

/**
 * `"all"` is the panel's own sentinel and never reaches the wire: the endpoint
 * takes `set_number` as an integer 1-5, and "every set" is that parameter being
 * omitted rather than a value it accepts. Sets 4 and 5 exist server-side for the
 * best-of-five men's Grand Slam format; the panel offers three because no other
 * system reaches them.
 */
export type SetFilter = "all" | "1" | "2" | "3";

/** Spelled as the API spells them, so the value a chip carries is the value the
 *  query sends. `phase` is snake_case on the wire and there is no "all". */
export type PhaseFilter =
  | "full"
  | "tiebreaks"
  | "break_points"
  | "game_points"
  | "set_points"
  | "match_points"
  | "game_ending"
  | "set_ending";

/** `"all"` is the panel's own sentinel and never reaches the wire, same
 *  convention as `SetFilter` — the endpoint takes `surface` as an enum value
 *  or an omitted parameter for "every surface" (#225). */
export type SurfaceFilter = "all" | Surface;

export interface StatsFilters {
  scope: MatchScope;
  /** The real API's own opponent identity — `OpponentSummary.key`, not a
   *  UUID id. Named for what it actually is now that it reaches the wire. */
  opponentKey: string | null;
  set: SetFilter;
  phase: PhaseFilter;
  surface: SurfaceFilter;
}

export interface CoachNote {
  id: string;
  body: string;
  tags: string[];
  /** Calendar date, "YYYY-MM-DD", same convention as the API's date fields. */
  recordedOn: string;
  context: string | null;
  linkedMatchId: string | null;
}

export interface InProgressMatch {
  matchId: string;
  playerId: string;
  playerName: string;
  opponentName: string;
  score: string;
  elapsed: string;
}

export type AttentionTier = "hard-flag" | "decline";

/** The winner of the home screen's single "needs attention" slot — see
 *  `lib/analytics/attention.ts` for how the tiers are compared. */
export interface AttentionResult {
  playerId: string;
  tier: AttentionTier;
  reason: string;
  /** Comparable across every candidate regardless of tier: `Infinity` for a
   *  hard flag (always outranks a decline), `|z|` for a decline. */
  severity: number;
}

/** One end of the squad's best/worst form ranking. */
export interface FormRankEntry {
  playerId: string;
  /** "W–L" over the player's own `last5`. */
  last5Record: string;
  /** Null wherever the API's own ratio is — a player with no forced or
   *  unforced points at all this period, not an absent player. */
  forcedToUnforcedRatio: number | null;
}

/** Per-player inputs behind the Squad stats page — built from the real
 *  `SquadMemberStats` payload plus the roster name it doesn't carry.
 *  `matchesLoggedThisPeriod` means the same thing here as on that payload. */
export interface SquadStatsEntry {
  playerId: string;
  wins: number;
  losses: number;
  /** Same field, same "capture can't distinguish a winner from a forced
   *  error" caveat as the real API's `forced_to_unforced_ratio` (#175/#206).
   *  Null wherever the API's own ratio is. */
  forcedToUnforcedRatio: number | null;
  /** Share of first-serve attempts landing in, 0–100. Null wherever the
   *  API's own percentage is. */
  firstServeInPercent: number | null;
  matchesLoggedThisPeriod: number;
}

/** Which of the three squad-wide metrics is selected — shared vocabulary
 *  between the leaderboard's dropdown and the spread histogram (which always
 *  mirrors it), and separately by the trend card's own dropdown. */
export type SquadMetricKey = "record" | "forcedToUnforced" | "firstServe";

/** One row of the Squad stats leaderboard, after the selected metric has
 *  been resolved to a single sortable number. */
export interface SquadLeaderboardRow {
  playerId: string;
  name: string;
  /** Null for a below-threshold row — the row shows `matchesLoggedThisPeriod`
   *  instead, never a fabricated value. */
  metricValue: number | null;
  matchesLoggedThisPeriod: number;
  /** Null alongside `metricValue`, for the same reason. */
  rank: number | null;
}

/** One bucket of the leaderboard's "Spread" histogram. */
export interface SquadHistogramBucket {
  /** The bucket's own value range, formatted for the metric (e.g. "40–52%"). */
  label: string;
  count: number;
}

/** The squad headline's three aggregate numbers, all matches, whole roster.
 *  The rate fields are null with nobody eligible to average; `matchesThisPeriod`
 *  is the card's own scope caption, since the true per-stat denominators behind
 *  a pooled squad-wide rate aren't on the payload (#249). */
export interface SquadHeadline {
  record: WinLossRecord;
  forcedToUnforcedRatio: number | null;
  firstServeInPercent: number | null;
  matchesThisPeriod: number;
}
