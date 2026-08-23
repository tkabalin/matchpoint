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

export type MetricUnit = "percent" | "ratio" | "perSet" | "perMatch";

/** One number a coach is shown, with everything needed to judge it. */
export interface Metric {
  label: string;
  value: number;
  unit: MetricUnit;
  /** Rendered verbatim next to the label ("n=14", "n=20 sets"). */
  sampleSize: string;
  /** The comparison this metric is judged against, in the same units. */
  baseline: number | null;
  /** Change over the window, in the same units. Sign carries the direction. */
  delta: number | null;
  /** Ceiling for the track. 100 for percentages, an explicit cap otherwise. */
  max: number;
  /** False for metrics like double faults, where down is the good direction. */
  higherIsBetter: boolean;
  /** Set only where the value isn't a plain number, e.g. a "7–3" record. */
  display?: string;
}

export type MatchOutcome = "win" | "loss";

export interface WinLossRecord {
  wins: number;
  losses: number;
}

/** A labelled quantity in a horizontal bar list (fault mode, shot type, etc.). */
export interface BreakdownRow {
  label: string;
  /** Primary count. */
  value: number;
  /** Second stacked count where a row splits (unforced vs. forced errors). */
  secondaryValue?: number;
  /** Ceiling the row's bar is drawn against, shared across the group. */
  max: number;
}

/** Read by the home screen, the roster list, and the player-profile's own
 *  record card — `seasonRecord`/`allTimeRecord` are that card's data. */
export interface PlayerOverview {
  form: Metric;
  holdPercentage: Metric;
  /** Forced points (a winner or a forced error — capture can't tell them
   *  apart, #175/#206) against unforced errors. The home screen's
   *  "Continue with" card is this field's only current reader. */
  forcedToUnforced: Metric;
  seasonRecord: WinLossRecord;
  allTimeRecord: WinLossRecord;
}

/** In/fault/ace counts for one serve attempt number (1st or 2nd) — three
 *  disjoint buckets that sum to 100, not `in` as a superset of `ace`. The
 *  headline "% in" a coach cares about is `in + ace` together, computed at
 *  the call site rather than stored as a fourth number that could drift out
 *  of sync with these three. */
export interface ServeOutcomeCounts {
  in: number;
  fault: number;
  ace: number;
}

export type ServeNumber = "first" | "second";

/** Where a fault landed, split by which serve attempt it was. */
export interface FaultModeSplit {
  firstServe: { net: number; long: number; wide: number };
  secondServe: { net: number; long: number; wide: number };
}

/** One match's serve-in rate, for the recent-matches trend line. */
export interface ServeTrendPoint {
  match: string;
  firstServeIn: number;
  secondServeIn: number;
}

export interface ServeSideStats {
  /** Split by serve number, like `faultMode` already is below — the hero
   *  headline and the outcome stack read from whichever half the 1st/2nd
   *  serve toggle has selected, rather than a fixed value that ignores it. */
  outcome: { firstServe: ServeOutcomeCounts; secondServe: ServeOutcomeCounts };
  faultMode: FaultModeSplit;
  trend: ServeTrendPoint[];
}

/** The tracked player's return outcome against the opponent's serve — in, or
 *  which way it missed — split by which serve attempt it was returning. */
export interface ReturnOutcomeSplit {
  firstServe: BreakdownRow[];
  secondServe: BreakdownRow[];
}

export interface ServeStats {
  /** Hero metric differs by side, so both sides carry a full set. */
  serving: ServeSideStats;
  /** Same shape as `serving`, plus the tracked player's own return outcome
   *  against the opponent's serve — there's nothing analogous on the serving side. */
  returning: ServeSideStats & { returnOutcome: ReturnOutcomeSplit };
}

/** One of the three ways a rally-ending point can be tallied for the drill-down. */
export type PointEnderKind = "forced" | "unforced" | "unusual";

/** Seven zones: deuce/ad × short/deep (the four in-court cells), plus
 *  net/long/wide for the ones that landed out. Label matches the zone exactly. */
export interface CourtZoneCount {
  zone: string;
  count: number;
}

/** Wing/shot-type/court-zone breakdown behind one point-ender style, when it
 *  has a setup shot to describe (forced and unforced do; unusual doesn't). */
export interface PointEnderStyleDetail {
  wing: { forehand: number; backhand: number } | null;
  shotType: BreakdownRow[];
  courtZones: CourtZoneCount[];
  /** Only set when `wing` is null — what kind of unusual point each one was. */
  unusualReasons: BreakdownRow[] | null;
}

/** One of the three tap-to-expand style cards under Point enders — its label
 *  names which side applied the pressure or gave the point away, which flips
 *  with the "You won/They won" toggle (e.g. "Forced (their pressure)" vs.
 *  "Forced (your pressure)"). "Forced" itself can't distinguish a clean
 *  winner from a forced error the point-ending capture stores them the same
 *  way (#175/#206), so the label never claims to. */
export interface PointEnderStyle {
  kind: PointEnderKind;
  label: string;
  count: number;
  detail: PointEnderStyleDetail;
}

/** How many points ended after roughly this many shots — not scoped to the
 *  "You won/They won" toggle, since the read this is for (serve/return vs.
 *  fitness) cuts across who won the point. */
export interface RallyLengthBucket {
  label: string;
  count: number;
}

export interface RallyStats {
  hero: Metric;
  won: number;
  lost: number;
  /** Radar axes: share of point-ending shots per wing×shot-type combination,
   *  0–1. One set per side of the "You won / They won" toggle. */
  shotFrequency: Record<"you" | "opponents", { shot: string; share: number }[]>;
  /** The explainer paragraph under the radar — how placement below is derived. */
  placementNote: Record<"you" | "opponents", string>;
  styles: Record<"you" | "opponents", readonly [PointEnderStyle, PointEnderStyle, PointEnderStyle]>;
  rallyLength: RallyLengthBucket[];
}

/**
 * Scope/filter state for the Serve and Rally tabs' scope panel. UI state
 * only — no fixture yet varies by set/phase, so this is what a coach has picked
 * and what the scope bar echoes back, not a query parameter. Recent form (below)
 * is the one exception: it does vary by scope, since it's the one piece the
 * mockup itself shows changing on Apply.
 */
export type MatchScope = "all" | "vs-opponent";
export type SetFilter = "all" | "1" | "2" | "3";
export type PhaseFilter =
  | "full"
  | "tiebreaks"
  | "breakPoints"
  | "gamePoints"
  | "setPoints"
  | "matchPoints"
  | "gameEnding"
  | "setEnding";

export interface StatsFilters {
  scope: MatchScope;
  opponentId: string | null;
  set: SetFilter;
  phase: PhaseFilter;
}

/** One opponent, for the "vs opponent" filter's picker. `recent` marks the
 *  "Most played" group; the rest are listed alphabetically underneath. */
export interface OpponentOption {
  id: string;
  name: string;
  matches: number;
  recent: boolean;
}

/** Recent match results, scoped to all matches or to one opponent. */
export interface RecentForm {
  results: MatchOutcome[];
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

/** A player flagged on the home screen because something moved the wrong way. */
export interface AttentionFlag {
  playerId: string;
  reason: string;
  recentResults: MatchOutcome[];
}

export interface InProgressMatch {
  matchId: string;
  playerId: string;
  playerName: string;
  opponentName: string;
  score: string;
  elapsed: string;
}

/** One stat tracked for a player's own-baseline decline check (the home
 *  screen's "needs attention" Tier 2 — see `lib/analytics/attention.ts`).
 *  Every stat here is oriented so a higher `current` is always the better
 *  direction, so a negative z-score always means "worse than usual for this
 *  player," never "worse in absolute terms." */
export interface TrackedStat {
  key: string;
  label: string;
  unit: MetricUnit;
  current: number;
  /** This player's own rolling average — never the squad average or a fixed
   *  target, so a naturally streaky player isn't judged against someone
   *  else's normal. */
  rollingMean: number;
  rollingStdDev: number;
}

/** Per-player inputs behind the home screen's squad snapshot — ranking for
 *  best/worst form, and the two-tier "needs attention" decision. */
export interface SquadMemberStats {
  playerId: string;
  /** Matches logged in the current ranking period (this season, this term —
   *  whatever window the eventual endpoint scopes to). */
  matchesLoggedThisPeriod: number;
  /** Most recent matches, oldest first, same convention as `PlayerOverview`. */
  last5: MatchOutcome[];
  forcedToUnforcedRatio: number;
  /** Zero-length when the player's last match wasn't itself a loss. */
  currentStreak: { outcome: MatchOutcome; length: number };
  /** Null when the player has never logged a match. */
  daysSinceLastMatch: number | null;
  trackedStats: TrackedStat[];
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
  forcedToUnforcedRatio: number;
}

/** Per-player inputs behind the Squad stats page — a sibling to
 *  `SquadMemberStats` (the home screen's own per-player shape), not a
 *  replacement: `matchesLoggedThisPeriod` means the same thing in both, but
 *  this carries the raw record and serve figure the leaderboard/headline
 *  need that the home screen doesn't. */
export interface SquadStatsEntry {
  playerId: string;
  wins: number;
  losses: number;
  /** Same field, same "capture can't distinguish a winner from a forced
   *  error" caveat as `PlayerOverview.forcedToUnforced` (#175/#206). */
  forcedToUnforcedRatio: number;
  /** Share of first-serve attempts landing in, 0–100. */
  firstServeInPercent: number;
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

/** The squad headline's three aggregate numbers, all matches, whole roster. */
export interface SquadHeadline {
  record: WinLossRecord;
  forcedToUnforcedRatio: number;
  firstServeInPercent: number;
}

/** One point in the squad trend card's last-6-weeks series. */
export interface SquadTrendPoint {
  week: string;
  value: number;
}
