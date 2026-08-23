import type {
  CoachNote,
  Metric,
  OpponentOption,
  PlayerOverview,
  RallyStats,
  RecentForm,
  ServeStats,
  ServeTrendPoint,
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
