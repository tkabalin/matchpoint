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
