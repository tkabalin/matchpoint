/**
 * Provisional shapes for analytics the API doesn't serve yet.
 *
 * Everything here is modelled as the generated DTO would be — numbers and units,
 * not display strings — so that when the endpoints land, only the hook bodies in
 * `use-analytics.ts` change and no component has to be touched.
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

/** A labelled quantity in a horizontal bar list (winners by shot type, etc.). */
export interface BreakdownRow {
  label: string;
  /** Primary count. */
  value: number;
  /** Second stacked count where a row splits (unforced vs. forced errors). */
  secondaryValue?: number;
  /** Ceiling the row's bar is drawn against, shared across the group. */
  max: number;
}

export interface Highlight {
  direction: "up" | "down";
  text: string;
}

export interface PlayerOverview {
  form: Metric;
  /** Most recent matches, oldest first. */
  recentResults: MatchOutcome[];
  holdPercentage: Metric;
  returnGamesWon: Metric;
  forcedToUnforced: Metric;
  seasonRecord: WinLossRecord;
  allTimeRecord: WinLossRecord;
  highlights: Highlight[];
  upcoming: { opponentName: string; when: string; note: string } | null;
}

export interface ServeStats {
  /** Hero metric differs by side, so both sides carry a full set. */
  serving: { hero: Metric; coachNote: string; metrics: Metric[]; breakdown: BreakdownRow[] };
  returning: { hero: Metric; coachNote: string; metrics: Metric[]; breakdown: BreakdownRow[] };
}

// One `forced` figure, not winners plus forced errors: capture deliberately records
// no distinction between a clean winner and a forced error (#175), so a split here
// would bake in numbers no point can ever supply (#206).
export interface OutcomeMix {
  label: string;
  forced: number;
  unforcedErrors: number;
}

export interface RallyStats {
  hero: Metric;
  coachNote: string;
  winnersByShot: BreakdownRow[];
  errorsByShot: BreakdownRow[];
  outcomeMix: OutcomeMix[];
  errorsUnderPressure: Metric;
  errorsOverall: Metric;
  /** Radar axes: share of point-ending shots, 0–1 per shot type. */
  shotFrequency: { shot: string; share: number }[];
}

export type TrendWindow = "last5" | "last10" | "season";

export interface TrendStats {
  insight: string;
  metrics: Metric[];
  /** Histogram of one metric across matches, for the spread view. */
  distribution: { bucket: string; matches: number }[];
  distributionLabel: string;
  journalCorrelation: {
    tag: string;
    metricLabel: string;
    tagged: { sampleSize: number; value: number };
    untagged: { sampleSize: number; value: number };
  };
  /** Per-match points for the unforced-errors vs. games-lost scatter. */
  correlation: { unforcedErrors: number; gamesLost: number }[];
}

export interface HeadToHeadSummary {
  opponentId: string;
  opponentName: string;
  meetings: number;
  record: WinLossRecord;
  /** Null below the sample size where a rate would mislead. */
  winRate: number | null;
}

/** One metric's first-two vs. last-two meeting average, drawn as a slope line. */
export interface SlopeLine {
  label: string;
  first: number;
  last: number;
}

export interface HeadToHeadDetail extends HeadToHeadSummary {
  hero: Metric;
  /** Meeting by meeting, oldest first. */
  results: MatchOutcome[];
  exploit: string;
  avoid: string;
  /**
   * The slope graph. Exactly three lines, matching the three colours
   * .claude/rules/web-color.md allocates for it (yellow, indigo, violet) — a
   * fourth metric here would have no colour of its own to draw with.
   */
  slope: readonly [SlopeLine, SlopeLine, SlopeLine];
  lossPatterns: BreakdownRow[];
  yourServe: Metric[];
  theirServe: Metric[];
  winnersByShot: BreakdownRow[];
  shotFrequency: { shot: string; share: number }[];
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
