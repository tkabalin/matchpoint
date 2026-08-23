import type {
  CoachNote,
  Metric,
  OpponentOption,
  PhaseFilter,
  PlayerOverview,
  RallyStats,
  RecentForm,
  ServeStats,
  ServeTrendPoint,
  SetFilter,
  SquadMemberStats,
  SquadMetricKey,
  SquadStatsEntry,
  SquadTrendPoint,
} from "./types.provisional";

/**
 * Deterministic stand-in data for the analytics the API doesn't serve yet, using the
 * mockup's own numbers so the screens read the way they were designed to.
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
  form: percent("Form: win % last 5", 80, "n=5", 62, 12),
  holdPercentage: percent("Hold %", 72, "n=14", 68, 4),
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
};

const SERVE_TREND: ServeTrendPoint[] = [
  { match: "M1", firstServeIn: 61, secondServeIn: 52 },
  { match: "M2", firstServeIn: 64, secondServeIn: 49 },
  { match: "M3", firstServeIn: 68, secondServeIn: 55 },
  { match: "M4", firstServeIn: 65, secondServeIn: 51 },
  { match: "M5", firstServeIn: 70, secondServeIn: 58 },
  { match: "M6", firstServeIn: 68, secondServeIn: 54 },
];

const THEIR_SERVE_TREND: ServeTrendPoint[] = [
  { match: "M1", firstServeIn: 58, secondServeIn: 47 },
  { match: "M2", firstServeIn: 60, secondServeIn: 45 },
  { match: "M3", firstServeIn: 61, secondServeIn: 50 },
  { match: "M4", firstServeIn: 57, secondServeIn: 44 },
  { match: "M5", firstServeIn: 63, secondServeIn: 52 },
  { match: "M6", firstServeIn: 61, secondServeIn: 48 },
];

export const SERVE_STATS: ServeStats = {
  serving: {
    // Each side sums to 100 on its own — three disjoint buckets (in/fault/ace),
    // not `in` as a superset of `ace`. See `ServeOutcomeCounts`'s own comment.
    outcome: {
      firstServe: { in: 68, fault: 24, ace: 8 },
      secondServe: { in: 85, fault: 12, ace: 3 },
    },
    faultMode: {
      firstServe: { net: 55, long: 20, wide: 25 },
      secondServe: { net: 38, long: 34, wide: 28 },
    },
    trend: SERVE_TREND,
  },
  returning: {
    outcome: {
      firstServe: { in: 61, fault: 31, ace: 8 },
      secondServe: { in: 80, fault: 15, ace: 5 },
    },
    faultMode: {
      firstServe: { net: 48, long: 29, wide: 23 },
      secondServe: { net: 33, long: 37, wide: 30 },
    },
    trend: THEIR_SERVE_TREND,
    returnOutcome: {
      firstServe: [
        { label: "In", value: 74, max: 100 },
        { label: "Net", value: 11, max: 100 },
        { label: "Long", value: 9, max: 100 },
        { label: "Wide", value: 6, max: 100 },
      ],
      secondServe: [
        { label: "In", value: 86, max: 100 },
        { label: "Net", value: 7, max: 100 },
        { label: "Long", value: 4, max: 100 },
        { label: "Wide", value: 3, max: 100 },
      ],
    },
  },
};

const RADAR_AXES = [
  "FH Drive",
  "FH Volley",
  "FH Drop",
  "FH Lob",
  "BH Lob",
  "BH Drop",
  "BH Volley",
  "BH Drive",
];

function shotFrequencyFor(shares: number[]) {
  return RADAR_AXES.map((shot, index) => ({ shot, share: shares[index]! }));
}

const YOU_WON_GAP_NOTE =
  "Wing and shot type describe the setup shot: the winner's last shot that landed in. Forced means your shot put the opponent under real pressure and their error (or your winner) followed from that; unforced means they missed a routine ball with no real pressure on it.";
const THEY_WON_GAP_NOTE =
  "Wing and shot type describe the setup shot: the winner's last shot that landed in. Forced means their shot put you under real pressure and your error (or their winner) followed from that; unforced means you missed a routine ball with no real pressure on it.";

// These numbers reconcile with each other — this screen gets screenshotted
// for the client, and a coach working through the cards would notice if they
// didn't:
//   - styles.you's three counts sum to `won` (42); styles.opponents' three
//     sum to `lost` (31).
//   - hero.value is (styles.you.forced + styles.opponents.forced) /
//     (styles.you.unforced + styles.opponents.unforced) = 45/25 = 1.8.
//   - rallyLength sums to `won + lost` (73).
export const RALLY_STATS: RallyStats = {
  hero: {
    label: "Forced : Unforced ratio",
    value: 1.8,
    unit: "ratio",
    sampleSize: "n=14",
    baseline: 1.5,
    delta: 0.3,
    max: 3,
    higherIsBetter: true,
  },
  won: 42,
  lost: 31,
  rallyLength: [
    { label: "1–3 shots", count: 28 },
    { label: "4–6 shots", count: 22 },
    { label: "7–9 shots", count: 14 },
    { label: "10+ shots", count: 9 },
  ],
  shotFrequency: {
    you: shotFrequencyFor([0.85, 0.55, 0.35, 0.2, 0.15, 0.25, 0.4, 0.6]),
    opponents: shotFrequencyFor([0.45, 0.3, 0.2, 0.15, 0.25, 0.4, 0.55, 0.75]),
  },
  placementNote: {
    you: YOU_WON_GAP_NOTE,
    opponents: THEY_WON_GAP_NOTE,
  },
  styles: {
    you: [
      {
        kind: "forced",
        label: "Forced (their pressure)",
        count: 27,
        detail: {
          wing: { forehand: 15, backhand: 12 },
          shotType: [
            { label: "Drive", value: 12, max: 15 },
            { label: "Volley", value: 8, max: 15 },
            { label: "Dropshot", value: 5, max: 15 },
            { label: "Lob", value: 2, max: 15 },
          ],
          courtZones: [
            { zone: "Deuce short", count: 0 },
            { zone: "Deuce deep", count: 2 },
            { zone: "Ad short", count: 0 },
            { zone: "Ad deep", count: 0 },
            { zone: "Net", count: 3 },
            { zone: "Long", count: 2 },
            { zone: "Wide", count: 1 },
          ],
          unusualReasons: null,
        },
      },
      {
        kind: "unforced",
        label: "Unforced (their free error)",
        count: 13,
        detail: {
          wing: { forehand: 6, backhand: 7 },
          shotType: [
            { label: "Drive", value: 5, max: 6 },
            { label: "Volley", value: 4, max: 6 },
            { label: "Dropshot", value: 3, max: 6 },
            { label: "Lob", value: 1, max: 6 },
          ],
          courtZones: [
            { zone: "Deuce short", count: 0 },
            { zone: "Deuce deep", count: 1 },
            { zone: "Ad short", count: 0 },
            { zone: "Ad deep", count: 0 },
            { zone: "Net", count: 7 },
            { zone: "Long", count: 4 },
            { zone: "Wide", count: 1 },
          ],
          unusualReasons: null,
        },
      },
      {
        kind: "unusual",
        label: "Unusual (in your favor)",
        count: 2,
        detail: {
          wing: null,
          shotType: [],
          courtZones: [],
          unusualReasons: [
            { label: "Net touch", value: 1, max: 2 },
            { label: "Hindrance", value: 1, max: 2 },
          ],
        },
      },
    ],
    opponents: [
      {
        kind: "forced",
        label: "Forced (your pressure)",
        count: 18,
        detail: {
          wing: { forehand: 10, backhand: 8 },
          shotType: [
            { label: "Drive", value: 8, max: 10 },
            { label: "Volley", value: 6, max: 10 },
            { label: "Dropshot", value: 3, max: 10 },
            { label: "Lob", value: 1, max: 10 },
          ],
          courtZones: [
            { zone: "Deuce short", count: 0 },
            { zone: "Deuce deep", count: 0 },
            { zone: "Ad short", count: 0 },
            { zone: "Ad deep", count: 1 },
            { zone: "Net", count: 3 },
            { zone: "Long", count: 1 },
            { zone: "Wide", count: 1 },
          ],
          unusualReasons: null,
        },
      },
      {
        kind: "unforced",
        label: "Unforced (your free error)",
        count: 12,
        detail: {
          wing: { forehand: 5, backhand: 7 },
          shotType: [
            { label: "Drive", value: 5, max: 5 },
            { label: "Volley", value: 3, max: 5 },
            { label: "Dropshot", value: 3, max: 5 },
            { label: "Lob", value: 1, max: 5 },
          ],
          courtZones: [
            { zone: "Deuce short", count: 0 },
            { zone: "Deuce deep", count: 0 },
            { zone: "Ad short", count: 0 },
            { zone: "Ad deep", count: 0 },
            { zone: "Net", count: 5 },
            { zone: "Long", count: 3 },
            { zone: "Wide", count: 2 },
          ],
          unusualReasons: null,
        },
      },
      {
        kind: "unusual",
        label: "Unusual (against you)",
        count: 1,
        detail: {
          wing: null,
          shotType: [],
          courtZones: [],
          unusualReasons: [{ label: "Point penalty", value: 1, max: 1 }],
        },
      },
    ],
  },
};

/**
 * Set/Phase don't have a real backend to bucket by yet (see the GitLab issue
 * filed against this gap), so this scales `RALLY_STATS`/`SERVE_STATS`
 * deterministically instead of returning one static object regardless of
 * the panel's selection — the point is "changing the dropdown visibly
 * changes the numbers," not exhaustive realism. Style-card *headline* counts
 * (won/lost/hero/rallyLength) are recomputed from the scaled counts so those
 * stay mutually consistent; each style's own wing/shot-type/court-zone
 * drill-down detail is left at its base value; a coach would need to expand
 * a style card and total the wing split by hand to notice the drift, far
 * less visible than the top-of-card numbers matching.
 */
// A small deterministic hash so any opponent id (not just a hand-picked few)
// gets its own, stable-across-reloads variant — "vs opponent" scope needs
// coverage for the whole roster, not just the handful `RECENT_FORM` names.
function hashUnit(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/** 0.7–1.3, centred on 1 — a mild per-opponent shift, not a different match altogether. */
function opponentScale(opponentId: string | null): number {
  return opponentId === null ? 1 : 0.7 + hashUnit(opponentId) * 0.6;
}

function opponentWeight(opponentId: string | null): [number, number, number] {
  if (opponentId === null) return [1, 1, 1];
  const seed = hashUnit(opponentId);
  return [
    0.75 + seed * 0.5,
    0.75 + hashUnit(opponentId + "f") * 0.5,
    0.75 + hashUnit(opponentId + "a") * 0.5,
  ];
}

const RALLY_SET_SCALE: Record<SetFilter, number> = { all: 1, "1": 0.55, "2": 0.85, "3": 0.4 };
const RALLY_PHASE_SCALE: Record<PhaseFilter, number> = {
  full: 1,
  tiebreaks: 0.12,
  breakPoints: 0.2,
  gamePoints: 0.35,
  setPoints: 0.15,
  matchPoints: 0.08,
  gameEnding: 0.5,
  setEnding: 0.25,
};

function scaleCount(count: number, factor: number): number {
  return Math.max(0, Math.round(count * factor));
}

export function rallyStatsFor(filters: {
  set: SetFilter;
  phase: PhaseFilter;
  opponentId?: string | null;
  /** Composes with set/phase — the per-match view starts from a smaller
   *  "one match's worth" base before its own Set/Phase filter narrows further. */
  scale?: number;
}): RallyStats {
  const factor =
    RALLY_SET_SCALE[filters.set] *
    RALLY_PHASE_SCALE[filters.phase] *
    opponentScale(filters.opponentId ?? null) *
    (filters.scale ?? 1);
  if (factor === 1) return RALLY_STATS;

  const styles = {
    you: RALLY_STATS.styles.you.map((style) => ({
      ...style,
      count: scaleCount(style.count, factor),
    })),
    opponents: RALLY_STATS.styles.opponents.map((style) => ({
      ...style,
      count: scaleCount(style.count, factor),
    })),
  } as unknown as RallyStats["styles"];

  const won = styles.you.reduce((sum, style) => sum + style.count, 0);
  const lost = styles.opponents.reduce((sum, style) => sum + style.count, 0);
  const forced =
    (styles.you.find((style) => style.kind === "forced")?.count ?? 0) +
    (styles.opponents.find((style) => style.kind === "forced")?.count ?? 0);
  const unforced =
    (styles.you.find((style) => style.kind === "unforced")?.count ?? 0) +
    (styles.opponents.find((style) => style.kind === "unforced")?.count ?? 0);
  const heroValue = unforced === 0 ? forced : Math.round((forced / unforced) * 10) / 10;

  return {
    ...RALLY_STATS,
    hero: { ...RALLY_STATS.hero, value: heroValue },
    won,
    lost,
    rallyLength: RALLY_STATS.rallyLength.map((bucket) => ({
      ...bucket,
      count: scaleCount(bucket.count, factor),
    })),
    styles,
  };
}

// Per-arm weights for {in, fault, ace}, renormalized to sum to 100 below —
// a uniform scale would cancel out under renormalization, so each variant
// needs its own, different-shaped weighting to actually shift the ratio.
const SERVE_SET_WEIGHT: Record<SetFilter, [number, number, number]> = {
  all: [1, 1, 1],
  "1": [1.1, 0.8, 1.3],
  "2": [0.95, 1.1, 0.9],
  "3": [0.8, 1.3, 0.7],
};
const SERVE_PHASE_WEIGHT: Record<PhaseFilter, [number, number, number]> = {
  full: [1, 1, 1],
  tiebreaks: [0.7, 1.4, 1.6],
  breakPoints: [0.85, 1.2, 0.6],
  gamePoints: [1.05, 0.9, 1.1],
  setPoints: [0.9, 1.15, 0.8],
  matchPoints: [0.75, 1.3, 1.2],
  gameEnding: [1, 1, 1.4],
  setEnding: [0.95, 1.05, 1],
};

function normalizedTriple(values: readonly [number, number, number]): {
  in: number;
  fault: number;
  ace: number;
} {
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const scaled = values.map((value) => (value / total) * 100);
  const rounded = scaled.map(Math.round);
  const remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const maxIndex = rounded.indexOf(Math.max(...rounded));
  rounded[maxIndex]! += remainder;
  return { in: rounded[0]!, fault: rounded[1]!, ace: rounded[2]! };
}

export function serveStatsFor(filters: {
  set: SetFilter;
  phase: PhaseFilter;
  opponentId?: string | null;
  /** Composes with set/phase, same purpose as `rallyStatsFor`'s `scale`. */
  matchWeight?: readonly [number, number, number];
}): ServeStats {
  const setWeight = SERVE_SET_WEIGHT[filters.set];
  const phaseWeight = SERVE_PHASE_WEIGHT[filters.phase];
  const oppWeight = opponentWeight(filters.opponentId ?? null);
  const matchWeight = filters.matchWeight ?? [1, 1, 1];
  if (
    setWeight.every((w) => w === 1) &&
    phaseWeight.every((w) => w === 1) &&
    oppWeight.every((w) => w === 1) &&
    matchWeight.every((w) => w === 1)
  ) {
    return SERVE_STATS;
  }

  const weight: [number, number, number] = [
    setWeight[0] * phaseWeight[0] * oppWeight[0] * matchWeight[0],
    setWeight[1] * phaseWeight[1] * oppWeight[1] * matchWeight[1],
    setWeight[2] * phaseWeight[2] * oppWeight[2] * matchWeight[2],
  ];

  function scaleOutcome(outcome: { in: number; fault: number; ace: number }) {
    return normalizedTriple([
      outcome.in * weight[0],
      outcome.fault * weight[1],
      outcome.ace * weight[2],
    ]);
  }

  return {
    serving: {
      ...SERVE_STATS.serving,
      outcome: {
        firstServe: scaleOutcome(SERVE_STATS.serving.outcome.firstServe),
        secondServe: scaleOutcome(SERVE_STATS.serving.outcome.secondServe),
      },
    },
    returning: {
      ...SERVE_STATS.returning,
      outcome: {
        firstServe: scaleOutcome(SERVE_STATS.returning.outcome.firstServe),
        secondServe: scaleOutcome(SERVE_STATS.returning.outcome.secondServe),
      },
    },
  };
}

export const OPPONENTS: OpponentOption[] = [
  { id: "sarah-k", name: "Sarah K", matches: 14, recent: true },
  { id: "priya-m", name: "Priya M", matches: 9, recent: true },
  { id: "danny-g", name: "Danny G", matches: 6, recent: true },
  { id: "alex-t", name: "Alex T", matches: 5, recent: false },
  { id: "ben-h", name: "Ben H", matches: 4, recent: false },
  { id: "chloe-w", name: "Chloe W", matches: 4, recent: false },
  { id: "femi-o", name: "Femi O", matches: 3, recent: false },
  { id: "grace-l", name: "Grace L", matches: 2, recent: false },
  { id: "ivan-s", name: "Ivan S", matches: 2, recent: false },
  { id: "jules-p", name: "Jules P", matches: 1, recent: false },
  { id: "nadia-r", name: "Nadia R", matches: 1, recent: false },
  { id: "owen-b", name: "Owen B", matches: 1, recent: false },
];

export const RECENT_FORM: Record<string, RecentForm> = {
  all: { results: ["win", "win", "loss", "win", "win"] },
  "sarah-k": { results: ["win", "loss", "win", "win", "loss"] },
  "priya-m": { results: ["win", "win", "win", "loss", "win"] },
  "danny-g": { results: ["loss", "win", "loss", "win", "win"] },
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

/**
 * PLACEHOLDER for a per-player squad-snapshot endpoint: until the API computes
 * these (rolling means/stddevs, streaks, days-since-last-match) server-side,
 * each real roster player is handed one of these hand-authored profiles by
 * position, cycling if the roster is longer than the list. Round-robin by
 * index rather than derived from the id keeps this fixture explicit and
 * reviewable, matching every other fixture in this file, while still varying
 * across the roster — a single shared profile (this file's usual pattern)
 * would make every player tie for both best and worst form.
 *
 * The six profiles between them exercise every branch of the decision in
 * `lib/analytics/attention.ts`: a clean best performer, a clean but weaker
 * one, a Tier 1 losing-streak flag, a Tier 1 stale-data flag, a Tier 2
 * statistical decline, and an unremarkable middle-of-the-pack player.
 */
const SQUAD_MEMBER_TEMPLATES: readonly Omit<SquadMemberStats, "playerId">[] = [
  {
    matchesLoggedThisPeriod: 6,
    last5: ["win", "win", "win", "win", "win"],
    forcedToUnforcedRatio: 2.1,
    currentStreak: { outcome: "win", length: 5 },
    daysSinceLastMatch: 2,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 2.1,
        rollingMean: 1.6,
        rollingStdDev: 0.3,
      },
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 66,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  },
  {
    matchesLoggedThisPeriod: 5,
    last5: ["loss", "win", "loss", "loss", "win"],
    forcedToUnforcedRatio: 0.7,
    currentStreak: { outcome: "win", length: 1 },
    daysSinceLastMatch: 3,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 0.7,
        rollingMean: 0.65,
        rollingStdDev: 0.2,
      },
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 58,
        rollingMean: 60,
        rollingStdDev: 6,
      },
    ],
  },
  {
    matchesLoggedThisPeriod: 9,
    last5: ["win", "loss", "loss", "loss", "loss"],
    forcedToUnforcedRatio: 0.9,
    currentStreak: { outcome: "loss", length: 4 },
    daysSinceLastMatch: 1,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 0.9,
        rollingMean: 1.1,
        rollingStdDev: 0.3,
      },
    ],
  },
  {
    matchesLoggedThisPeriod: 2,
    last5: ["win"],
    forcedToUnforcedRatio: 1.0,
    currentStreak: { outcome: "win", length: 1 },
    daysSinceLastMatch: 21,
    trackedStats: [],
  },
  {
    matchesLoggedThisPeriod: 7,
    last5: ["win", "win", "loss", "win", "loss"],
    forcedToUnforcedRatio: 1.3,
    currentStreak: { outcome: "loss", length: 1 },
    daysSinceLastMatch: 4,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 46,
        rollingMean: 64,
        rollingStdDev: 6,
      },
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 1.3,
        rollingMean: 1.3,
        rollingStdDev: 0.25,
      },
    ],
  },
  {
    matchesLoggedThisPeriod: 5,
    last5: ["win", "loss", "win", "loss", "win"],
    forcedToUnforcedRatio: 1.1,
    currentStreak: { outcome: "win", length: 1 },
    daysSinceLastMatch: 5,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 1.1,
        rollingMean: 1.15,
        rollingStdDev: 0.3,
      },
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 61,
        rollingMean: 62,
        rollingStdDev: 5,
      },
    ],
  },
];

export function squadMemberStatsFor(playerId: string, rosterIndex: number): SquadMemberStats {
  const template = SQUAD_MEMBER_TEMPLATES[rosterIndex % SQUAD_MEMBER_TEMPLATES.length]!;
  return { ...template, playerId };
}

// The Squad stats page's own per-player fixture: round-robins like
// `SQUAD_MEMBER_TEMPLATES` above, but carries the raw record and serve
// figure that page's leaderboard/headline need and `SquadMemberStats`
// doesn't. One template (index 3) sits below the 3-match ranking threshold
// on purpose, so the leaderboard's dimmed/unranked row has a real fixture.
const SQUAD_STATS_TEMPLATES: readonly Omit<SquadStatsEntry, "playerId">[] = [
  {
    wins: 8,
    losses: 2,
    forcedToUnforcedRatio: 1.6,
    firstServeInPercent: 68,
    matchesLoggedThisPeriod: 10,
  },
  {
    wins: 5,
    losses: 5,
    forcedToUnforcedRatio: 0.7,
    firstServeInPercent: 58,
    matchesLoggedThisPeriod: 10,
  },
  {
    wins: 1,
    losses: 8,
    forcedToUnforcedRatio: 0.9,
    firstServeInPercent: 46,
    matchesLoggedThisPeriod: 9,
  },
  {
    wins: 1,
    losses: 0,
    forcedToUnforcedRatio: 1.0,
    firstServeInPercent: 55,
    matchesLoggedThisPeriod: 1,
  },
  {
    wins: 4,
    losses: 3,
    forcedToUnforcedRatio: 1.3,
    firstServeInPercent: 61,
    matchesLoggedThisPeriod: 7,
  },
  {
    wins: 3,
    losses: 2,
    forcedToUnforcedRatio: 1.1,
    firstServeInPercent: 63,
    matchesLoggedThisPeriod: 5,
  },
];

export function squadStatsFor(playerId: string, rosterIndex: number): SquadStatsEntry {
  const template = SQUAD_STATS_TEMPLATES[rosterIndex % SQUAD_STATS_TEMPLATES.length]!;
  return { ...template, playerId };
}

const SQUAD_TREND: Record<SquadMetricKey, SquadTrendPoint[]> = {
  record: [
    { week: "Wk 1", value: 52 },
    { week: "Wk 2", value: 55 },
    { week: "Wk 3", value: 49 },
    { week: "Wk 4", value: 58 },
    { week: "Wk 5", value: 61 },
    { week: "Wk 6", value: 60 },
  ],
  forcedToUnforced: [
    { week: "Wk 1", value: 1.0 },
    { week: "Wk 2", value: 1.05 },
    { week: "Wk 3", value: 0.95 },
    { week: "Wk 4", value: 1.1 },
    { week: "Wk 5", value: 1.15 },
    { week: "Wk 6", value: 1.2 },
  ],
  firstServe: [
    { week: "Wk 1", value: 58 },
    { week: "Wk 2", value: 59 },
    { week: "Wk 3", value: 57 },
    { week: "Wk 4", value: 61 },
    { week: "Wk 5", value: 62 },
    { week: "Wk 6", value: 63 },
  ],
};

export function squadTrendFor(key: SquadMetricKey): SquadTrendPoint[] {
  return SQUAD_TREND[key];
}
