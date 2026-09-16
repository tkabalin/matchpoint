import type { Surface } from "@matchpoint/api-client";

/**
 * UI-side shapes for the analytics screens: filter/scope state with no server
 * counterpart, and derived shapes (leaderboard rows, headline aggregates) built
 * from real payloads rather than sent over the wire as-is.
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

/** Per-player inputs behind the Squad stats page — built from the real
 *  `SquadMemberStats` payload plus the roster name it doesn't carry.
 *  `matchesLoggedThisPeriod` means the same thing here as on that payload;
 *  it's a caption/weighting input only — nothing on this page gates a player
 *  out of the leaderboard by it. */
export interface SquadStatsEntry {
  playerId: string;
  wins: number;
  losses: number;
  /** Raw counts, not just the ratio — a coach reads "12 forcing shots, 1
   *  mistake" and "12 forcing shots, 12 mistakes" apart, which a single ratio
   *  number can't show (same reasoning as the player card's own split
   *  display). Same "capture can't distinguish a winner from a forced error"
   *  caveat as the real API's fields (#175/#206). */
  forcedCount: number;
  unforcedCount: number;
  /** Still needed for sorting the leaderboard/pooling the trend — the split
   *  counts above are what's actually shown, this is what ranks by it. Null
   *  wherever the API's own ratio is. */
  forcedToUnforcedRatio: number | null;
  /** Share of first-serve attempts landing in, 0–100. Null wherever the
   *  API's own percentage is. */
  firstServeInPercent: number | null;
  matchesLoggedThisPeriod: number;
  /** Errors the opponent forced onto this player — Resilience's own
   *  denominator input alongside `unforcedCount` above (#267). */
  forcedErrorsSuffered: number;
  /** Points this player won this period — Tactical Efficiency's own
   *  denominator (#267). */
  pointsWon: number;
}

/** Which squad-wide metric is selected. The leaderboard and the trend card
 *  each only support a subset of these (see `SquadLeaderboardMetricKey`/
 *  `SquadTrendMetricKey` below) — this wider union is only what
 *  `metricValue`/`metricDisplay`/`METRIC_LABEL`/etc. in `squad-stats.ts` are
 *  keyed by, since that logic is shared between both cards. */
export type SquadMetricKey =
  | "record"
  | "forcedToUnforced"
  | "firstServe"
  | "pressureIndex"
  | "resilience"
  | "tacticalEfficiency";

/** The trend chart's own metric set (#267) — unchanged by the leaderboard's
 *  replacement below, since the squad trend wire endpoint (`SquadMetric`)
 *  can only ever serve these three; it has no way to trend Pressure Index,
 *  Resilience or Tactical Efficiency. */
export type SquadTrendMetricKey = "record" | "forcedToUnforced" | "firstServe";

/** The leaderboard's own metric set (#267) — replaces the old
 *  Forced:Unforced ratio-only leaderboard with three metrics scoped to the
 *  leaderboard specifically (Pressure Index keeps the same underlying
 *  forced/unforced numbers, just ranked by difference instead of ratio, so
 *  it still needs no percentage display). */
export type SquadLeaderboardMetricKey =
  "record" | "firstServe" | "pressureIndex" | "resilience" | "tacticalEfficiency";

/** One row of the Squad stats leaderboard, after the selected metric has
 *  been resolved to a single sortable number. No minimum-matches threshold
 *  gates this — a player with *some* data still ranks. A player with no
 *  computable value at all for the selected metric (#267: e.g. Resilience
 *  with no errors either way yet) is excluded from the leaderboard entirely
 *  by `buildLeaderboard` before this row shape exists, rather than kept as a
 *  null-valued row — `metricValue` stays nullable in the type only because
 *  nothing prevents a caller from constructing one outside that function. */
export interface SquadLeaderboardRow {
  playerId: string;
  name: string;
  metricValue: number | null;
  matchesLoggedThisPeriod: number;
  rank: number;
}

/** The squad headline's aggregate numbers, all matches, whole roster.
 *  `matchesThisPeriod` is the card's own scope caption, since the true
 *  per-stat denominators behind a pooled squad-wide rate aren't on the
 *  payload (#249). */
export interface SquadHeadline {
  record: WinLossRecord;
  forcedCount: number;
  unforcedCount: number;
  firstServeInPercent: number | null;
  matchesThisPeriod: number;
}
