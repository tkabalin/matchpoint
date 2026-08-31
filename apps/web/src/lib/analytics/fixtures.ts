import type { CoachNote, SquadMetricKey, SquadStatsEntry } from "./types.provisional";

/**
 * `squadMemberStatsFor`/`squadTrendFor` below have no remaining call site —
 * `/squad/analytics/members` and `/squad/analytics/trend` are real endpoints
 * now — but their own tests still exercise them until fixtures.ts is deleted
 * in full (#224). These two shapes exist only for that: the real, generated
 * `SquadMemberStats`/`SquadTrendPoint` (snake_case, nullable rates) replaced
 * the versions `types.provisional.ts` used to export.
 */
interface FixtureTrackedStat {
  key: string;
  label: string;
  unit: "percent" | "ratio";
  current: number;
  rollingMean: number;
  rollingStdDev: number;
}

interface FixtureSquadMemberStats {
  playerId: string;
  matchesLoggedThisPeriod: number;
  last5: ("win" | "loss")[];
  forcedToUnforcedRatio: number;
  currentStreak: { outcome: "win" | "loss"; length: number };
  daysSinceLastMatch: number | null;
  trackedStats: FixtureTrackedStat[];
}

interface FixtureSquadTrendPoint {
  week: string;
  value: number;
}

/**
 * Deterministic stand-in data for the analytics the API doesn't serve yet, using the
 * mockup's own numbers so the screens read the way they were designed to.
 *
 * Fixed rather than generated: these screens get reviewed and screenshotted, and a
 * chart that reshuffles on every reload can't be compared against the design or
 * against yesterday's build.
 */

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
const SQUAD_MEMBER_TEMPLATES: readonly Omit<FixtureSquadMemberStats, "playerId">[] = [
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

export function squadMemberStatsFor(
  playerId: string,
  rosterIndex: number,
): FixtureSquadMemberStats {
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

const SQUAD_TREND: Record<SquadMetricKey, FixtureSquadTrendPoint[]> = {
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

export function squadTrendFor(key: SquadMetricKey): FixtureSquadTrendPoint[] {
  return SQUAD_TREND[key];
}
