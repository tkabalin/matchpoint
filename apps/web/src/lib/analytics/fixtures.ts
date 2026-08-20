import type {
  CoachNote,
  HeadToHeadDetail,
  HeadToHeadSummary,
  Metric,
  PlayerOverview,
  RallyStats,
  ServeStats,
  TrendStats,
  TrendWindow,
} from "./types.provisional";

/**
 * Deterministic stand-in data for the analytics the API doesn't serve yet, using the
 * wireframe's own numbers so the screens read the way they were designed to.
 *
 * Fixed rather than generated: these screens get reviewed and screenshotted, and a
 * chart that reshuffles on every reload can't be compared against the design or
 * against yesterday's build.
 */

function percent(
  label: string,
  value: number,
  sampleSize: string,
  baseline: number | null,
  delta: number | null,
  higherIsBetter = true,
): Metric {
  return { label, value, unit: "percent", sampleSize, baseline, delta, max: 100, higherIsBetter };
}

export const PLAYER_OVERVIEW: PlayerOverview = {
  form: percent("Form — win % last 5", 80, "n=5", 62, 12),
  recentResults: ["win", "win", "loss", "win", "win"],
  holdPercentage: percent("Hold %", 72, "n=14", 68, 4),
  returnGamesWon: percent("Return games won %", 31, "n=14", 33, -2),
  forcedToUnforced: {
    label: "Forced : Unforced ratio",
    value: 1.4,
    unit: "ratio",
    sampleSize: "n=14",
    baseline: 1.5,
    delta: 0.2,
    max: 3,
    higherIsBetter: true,
  },
  seasonRecord: { wins: 14, losses: 6 },
  allTimeRecord: { wins: 52, losses: 28 },
  highlights: [
    { direction: "up", text: "Strong 1st serve win rate — 71%" },
    { direction: "down", text: "High backhand unforced errors — 11/match" },
  ],
  upcoming: {
    opponentName: "A. Torres",
    when: "Sat 10:00",
    note: "0–2 vs Torres. 3 of his 4 wins came on your break points.",
  },
};

export const SERVE_STATS: ServeStats = {
  serving: {
    hero: percent("Hold % (service games won)", 72, "n=14", 68, 4),
    coachNote: "Holding at a career high — worth locking in this service routine.",
    metrics: [
      percent("Break pts saved", 67, "n=9", 61, 6),
      percent("1st serve in %", 61, "n=112", 64, -3),
      percent("1st serve pts won", 71, "n=68", 66, 5),
      percent("2nd serve pts won", 54, "n=44", 56, -2),
      {
        label: "Double faults / set",
        value: 1.8,
        unit: "perSet",
        sampleSize: "n=20 sets",
        baseline: 2.2,
        delta: -0.4,
        max: 5,
        higherIsBetter: false,
      },
      {
        label: "Aces / match",
        value: 3.2,
        unit: "perMatch",
        sampleSize: "n=14",
        baseline: 2.6,
        delta: 0.6,
        max: 6,
        higherIsBetter: true,
      },
    ],
    breakdown: [
      { label: "Serve winner (ace)", value: 18, max: 28 },
      { label: "Forehand (2nd shot)", value: 7, max: 28 },
      { label: "Double fault", value: 10, max: 28 },
    ],
  },
  returning: {
    hero: percent("Return games won %", 31, "n=14", 33, -2),
    coachNote: "Break points are being created — conversion is where the games are going.",
    metrics: [
      percent("Break pts converted", 48, "n=8", 39, 9),
      percent("1st serve return pts won", 34, "n=98", 36, -2),
      percent("2nd serve return pts won", 52, "n=57", 49, 3),
    ],
    breakdown: [
      { label: "Return winner", value: 6, max: 20 },
      { label: "Forehand return", value: 9, max: 20 },
      { label: "Return error", value: 14, max: 20 },
    ],
  },
};

export const RALLY_STATS: RallyStats = {
  hero: {
    label: "Forced : Unforced ratio",
    value: 1.4,
    unit: "ratio",
    sampleSize: "n=14",
    baseline: 1.5,
    delta: 0.2,
    max: 3,
    higherIsBetter: true,
  },
  coachNote: "Trending up — errors are converting to winners more often than last month.",
  winnersByShot: [
    { label: "Forehand", value: 12, max: 20 },
    { label: "Backhand", value: 6, max: 20 },
    { label: "Volley", value: 3, max: 20 },
  ],
  errorsByShot: [
    { label: "Backhand", value: 11, secondaryValue: 4, max: 20 },
    { label: "Forehand", value: 9, secondaryValue: 3, max: 20 },
  ],
  outcomeMix: [
    { label: "You", forced: 60, unforcedErrors: 40 },
    { label: "Opponents", forced: 50, unforcedErrors: 50 },
  ],
  errorsUnderPressure: percent("Errors under pressure (BP)", 44, "n=9", 29, 15, false),
  errorsOverall: percent("Errors overall", 29, "n=112", null, null, false),
  // The four stored shot types (#175): wing x type is what capture keeps, smash
  // folded into volley, so the radar has no overhead or slice axis to draw (#206).
  shotFrequency: [
    { shot: "Drive", share: 0.58 },
    { shot: "Volley", share: 0.22 },
    { shot: "Drop shot", share: 0.06 },
    { shot: "Lob", share: 0.14 },
  ],
};

const TREND_SAMPLE: Record<TrendWindow, string> = {
  last5: "n=5",
  last10: "n=10",
  season: "n=20",
};

export function trendStatsFor(window: TrendWindow): TrendStats {
  const n = TREND_SAMPLE[window];
  return {
    insight: "Break-point conversion +9 pts over 8 matches",
    metrics: [
      percent("Form", 70, n, 62, 8),
      percent("Hold %", 72, n, 68, 4),
      percent("Return games won %", 31, n, 33, -2),
      {
        label: "Forced:Unforced ratio",
        value: 1.4,
        unit: "ratio",
        sampleSize: n,
        baseline: 1.5,
        delta: 0.2,
        max: 3,
        higherIsBetter: true,
      },
      percent("Break-point conversion", 48, "n=8", 39, 9),
      percent("2nd serve won %", 54, n, 56, -2),
      {
        label: "Double faults / set",
        value: 1.8,
        unit: "perSet",
        sampleSize: "n=20 sets",
        baseline: 2.2,
        delta: -0.4,
        max: 5,
        higherIsBetter: false,
      },
    ],
    distributionLabel: "1st serve in %",
    distribution: [
      { bucket: "50–55%", matches: 1 },
      { bucket: "55–60%", matches: 3 },
      { bucket: "60–65%", matches: 4 },
      { bucket: "65–70%", matches: 2 },
    ],
    journalCorrelation: {
      tag: "worked on toss",
      metricLabel: "BP saved",
      tagged: { sampleSize: 5, value: 71 },
      untagged: { sampleSize: 9, value: 54 },
    },
    correlation: [
      { unforcedErrors: 8, gamesLost: 4 },
      { unforcedErrors: 10, gamesLost: 6 },
      { unforcedErrors: 12, gamesLost: 5 },
      { unforcedErrors: 14, gamesLost: 7 },
      { unforcedErrors: 15, gamesLost: 6 },
      { unforcedErrors: 17, gamesLost: 8 },
      { unforcedErrors: 18, gamesLost: 7 },
      { unforcedErrors: 20, gamesLost: 9 },
      { unforcedErrors: 21, gamesLost: 8 },
      { unforcedErrors: 23, gamesLost: 10 },
    ],
  };
}

export const HEAD_TO_HEAD: HeadToHeadSummary[] = [
  {
    opponentId: "torres",
    opponentName: "A. Torres",
    meetings: 4,
    record: { wins: 3, losses: 1 },
    winRate: 67,
  },
  {
    opponentId: "naidoo",
    opponentName: "T. Naidoo",
    meetings: 2,
    record: { wins: 1, losses: 1 },
    winRate: null,
  },
  {
    opponentId: "reyes",
    opponentName: "J. Reyes",
    meetings: 1,
    record: { wins: 0, losses: 1 },
    winRate: null,
  },
];

export const HEAD_TO_HEAD_DETAIL: HeadToHeadDetail = {
  ...HEAD_TO_HEAD[0]!,
  hero: percent("4 meetings · 3–1", 67, "n=4", 65, 2),
  results: ["win", "loss", "win", "win"],
  exploit:
    "Her backhand under pressure — 6 of her last 9 break-point unforced errors were backhand",
  avoid: "Her forehand — she's winning 70% of points ending on it against you",
  slope: [
    { label: "Hold %", first: 58, last: 74 },
    { label: "BP conv", first: 32, last: 48 },
    // Scaled onto the same 0–100 axis as the other two so one chart can carry all
    // three: the underlying ratio runs 1.0 → 1.6 on a 0–3 scale.
    { label: "F:UE", first: 33, last: 53 },
  ],
  lossPatterns: [
    { label: "Late-set fade", value: 1, max: 1 },
    { label: "Broken early", value: 0, max: 1 },
    { label: "Tiebreak", value: 0, max: 1 },
  ],
  yourServe: [
    percent("1st serve won", 71, "n=44", 66, 5),
    percent("2nd serve won", 54, "n=30", 56, null),
    {
      label: "Double fault rate",
      value: 2,
      unit: "perSet",
      sampleSize: "4 DF",
      baseline: null,
      delta: null,
      max: 5,
      higherIsBetter: false,
      display: "≈2/set",
    },
  ],
  theirServe: [
    percent("His 1st serve won", 63, "n=40", null, null),
    {
      label: "His ace rate",
      value: 2.5,
      unit: "perMatch",
      sampleSize: "n=4 matches",
      baseline: null,
      delta: null,
      max: 6,
      higherIsBetter: false,
      display: "2.5/match",
    },
  ],
  winnersByShot: [
    { label: "Forehand", value: 12, max: 20 },
    { label: "Backhand", value: 6, max: 20 },
  ],
  shotFrequency: RALLY_STATS.shotFrequency,
};

export const COACH_NOTES: CoachNote[] = [
  {
    id: "note-toss",
    body: "Worked on toss height on 2nd serve today — much more consistent by end of session.",
    tags: ["technical", "worked on toss"],
    recordedOn: "2026-08-15",
    context: "practice",
    linkedMatchId: null,
  },
  {
    id: "note-third-set",
    body: "Tight in the 3rd set again vs Naidoo — visibly rushing between points on break points.",
    tags: ["mental", "vs T. Naidoo"],
    recordedOn: "2026-08-10",
    context: null,
    linkedMatchId: "match-naidoo",
  },
  {
    id: "note-shoulder",
    body: "Reports mild soreness in the hitting shoulder — monitor before next match.",
    tags: ["physical"],
    recordedOn: "2026-08-08",
    context: null,
    linkedMatchId: null,
  },
];
