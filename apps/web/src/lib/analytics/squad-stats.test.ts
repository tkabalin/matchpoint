import type {
  PointEnderKind,
  PointEnderStyle,
  PointEnderStyles,
  SquadTrendPoint,
} from "@matchpoint/api-client";
import { expect, test } from "vitest";

import {
  aggressionScore,
  buildLeaderboard,
  fillSquadTrendGaps,
  metricDisplay,
  metricValue,
  mistakeResilience,
  overallAverageRallyLength,
  periodResiliencePercent,
  periodWinPercent,
  pickBestWorst,
  rallyLengthSizeBucket,
  resiliencePercent,
  scaleToGroupRange,
  squadHeadline,
  tacticalEfficiencyPercent,
} from "./squad-stats";
import type { SquadStatsEntry } from "./types.provisional";

type Named = SquadStatsEntry & { name: string };

const alex: Named = {
  playerId: "alex",
  name: "Alex Chen",
  wins: 8,
  losses: 2,
  forcedCount: 16,
  unforcedCount: 10,
  forcedToUnforcedRatio: 1.6,
  firstServeInPercent: 68,
  matchesLoggedThisPeriod: 10,
  forcedErrorsSuffered: 6,
  pointsWon: 80,
};
const priya: Named = {
  playerId: "priya",
  name: "Priya Singh",
  wins: 1,
  losses: 8,
  forcedCount: 9,
  unforcedCount: 10,
  forcedToUnforcedRatio: 0.9,
  firstServeInPercent: 46,
  matchesLoggedThisPeriod: 9,
  forcedErrorsSuffered: 3,
  pointsWon: 40,
};
const rookie: Named = {
  playerId: "rookie",
  name: "Rookie Reed",
  wins: 1,
  losses: 0,
  forcedCount: 2,
  unforcedCount: 2,
  forcedToUnforcedRatio: 1.0,
  firstServeInPercent: 55,
  matchesLoggedThisPeriod: 1,
  forcedErrorsSuffered: 1,
  pointsWon: 10,
};

test("metricValue and metricDisplay resolve each metric key", () => {
  expect(metricValue(alex, "record")).toBeCloseTo(80);
  expect(metricValue(alex, "forcedToUnforced")).toBe(1.6);
  expect(metricValue(alex, "firstServe")).toBe(68);
  expect(metricValue(alex, "pressureIndex")).toBe(6);
  expect(metricValue(alex, "resilience")).toBeCloseTo(37.5);
  expect(metricValue(alex, "tacticalEfficiency")).toBeCloseTo(20);

  // "record" displays the win % it sorts by, not the "W–L" string — showing
  // both risked disagreeing (a 3–2 player can outrank a displayed 5–5 one).
  expect(metricDisplay(alex, "record")).toBe("80%");
  expect(metricDisplay(alex, "forcedToUnforced")).toBe("1.60");
  expect(metricDisplay(alex, "firstServe")).toBe("68%");
  expect(metricDisplay(alex, "resilience")).toBe("38%");
  expect(metricDisplay(alex, "tacticalEfficiency")).toBe("20%");
});

// Pressure Index is a signed difference (forced - unforced), not a
// percentage — a negative or zero balance both need to read plainly, not as
// "-0" or a fabricated sign on zero.
test("metricDisplay signs a positive Pressure Index and leaves zero/negative unsigned", () => {
  expect(metricDisplay(alex, "pressureIndex")).toBe("+6");
  expect(metricDisplay({ ...alex, forcedCount: 10, unforcedCount: 10 }, "pressureIndex")).toBe("0");
  expect(metricDisplay({ ...alex, forcedCount: 4, unforcedCount: 10 }, "pressureIndex")).toBe("-6");
});

test("resiliencePercent is a forced share of a player's own errors, null when neither has happened", () => {
  expect(resiliencePercent({ forcedErrorsSuffered: 3, unforcedCount: 1 })).toBeCloseTo(75);
  expect(resiliencePercent({ forcedErrorsSuffered: 0, unforcedCount: 0 })).toBeNull();
});

test("tacticalEfficiencyPercent is forcing shots induced over points won, null with no points won yet", () => {
  expect(tacticalEfficiencyPercent({ forcedCount: 16, pointsWon: 80 })).toBeCloseTo(20);
  expect(tacticalEfficiencyPercent({ forcedCount: 5, pointsWon: 0 })).toBeNull();
});

test("metricDisplay shows an em dash for a metric that isn't computable yet", () => {
  const noRatioYet: Named = { ...alex, forcedToUnforcedRatio: null };

  expect(metricDisplay(noRatioYet, "forcedToUnforced")).toBe("—");
});

test("squadHeadline sums wins/losses and raw forced/unforced counts, and weighs first-serve % by match count", () => {
  const headline = squadHeadline([alex, priya]);

  expect(headline.record).toEqual({ wins: 9, losses: 10 });
  expect(headline.forcedCount).toBe(alex.forcedCount + priya.forcedCount);
  expect(headline.unforcedCount).toBe(alex.unforcedCount + priya.unforcedCount);
  expect(headline.firstServeInPercent).toBeCloseTo(
    (68 * alex.matchesLoggedThisPeriod + 46 * priya.matchesLoggedThisPeriod) /
      (alex.matchesLoggedThisPeriod + priya.matchesLoggedThisPeriod),
  );
  expect(headline.matchesThisPeriod).toBe(
    alex.matchesLoggedThisPeriod + priya.matchesLoggedThisPeriod,
  );
});

test("squadHeadline returns a zeroed record, zeroed counts and a null rate for an empty squad", () => {
  const headline = squadHeadline([]);

  expect(headline.record).toEqual({ wins: 0, losses: 0 });
  expect(headline.forcedCount).toBe(0);
  expect(headline.unforcedCount).toBe(0);
  expect(headline.firstServeInPercent).toBeNull();
  expect(headline.matchesThisPeriod).toBe(0);
});

// No minimum-matches threshold any more: every player is ranked, including
// one with a single match logged (rookie: 1-0, a 100% record outranks
// everyone despite the small sample).
test("buildLeaderboard ranks every player by the selected metric, no threshold", () => {
  const rows = buildLeaderboard([alex, priya, rookie], "record", "");

  expect(rows.map((row) => row.name)).toEqual(["Rookie Reed", "Alex Chen", "Priya Singh"]);
  expect(rows[0]).toMatchObject({ rank: 1, metricValue: 100 });
  expect(rows[1]).toMatchObject({ rank: 2, metricValue: 80 });
  expect(rows[2]).toMatchObject({ rank: 3 });
});

test("buildLeaderboard reorders when the metric key changes", () => {
  // alex: 16-10=+6, priya: 9-10=-1, rookie: 2-2=0.
  const byPressure = buildLeaderboard([alex, priya, rookie], "pressureIndex", "");

  expect(byPressure.map((row) => row.name)).toEqual(["Alex Chen", "Rookie Reed", "Priya Singh"]);
});

// #267: a player with no computable value for the selected metric (nobody's
// logged either kind of error yet) is excluded from that metric's
// leaderboard entirely, not parked in a last-place "—" row — a player with
// zero errors either way isn't the same thing as this squad's steadiest or
// its most mistake-prone.
test("buildLeaderboard excludes a player with no computable metric value entirely", () => {
  const noErrorsYet: Named = { ...rookie, forcedErrorsSuffered: 0, unforcedCount: 0 };
  const rows = buildLeaderboard([alex, noErrorsYet], "resilience", "");

  expect(rows.map((row) => row.name)).toEqual(["Alex Chen"]);
});

// firstServe used to sort a null value last; it's now excluded the same way
// every other metric is, for consistency.
test("buildLeaderboard excludes a null firstServe value the same way as the newer metrics", () => {
  const noServeDataYet: Named = { ...rookie, firstServeInPercent: null };
  const rows = buildLeaderboard([alex, noServeDataYet], "firstServe", "");

  expect(rows.map((row) => row.name)).toEqual(["Alex Chen"]);
});

test("buildLeaderboard filters by search", () => {
  const rows = buildLeaderboard([alex, priya, rookie], "record", "priya");

  expect(rows).toHaveLength(1);
  expect(rows[0]!.name).toBe("Priya Singh");
});

function week(label: string, value: number | null): SquadTrendPoint {
  return { week: label, value };
}

test("fillSquadTrendGaps carries a single interior null forward from the preceding value", () => {
  const trend = [week("Wk 1", 60), week("Wk 2", null), week("Wk 3", 70)];

  const { trend: filled } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([60, 60, 70]);
});

test("fillSquadTrendGaps carries the same preceding value across a run of nulls, not the following one", () => {
  const trend = [week("Wk 1", 50), week("Wk 2", null), week("Wk 3", null), week("Wk 4", 80)];

  const { trend: filled } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([50, 50, 50, 80]);
});

test("fillSquadTrendGaps leaves leading nulls untouched — nothing to carry forward yet", () => {
  const trend = [week("Wk 1", null), week("Wk 2", null), week("Wk 3", 65)];

  const { trend: filled } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([null, null, 65]);
});

test("fillSquadTrendGaps leaves an all-null trend unchanged", () => {
  const trend = [week("Wk 1", null), week("Wk 2", null)];

  const { trend: filled, carriedIndices } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([null, null]);
  expect(carriedIndices.size).toBe(0);
});

test("fillSquadTrendGaps fills every null after a single real value, and none before it", () => {
  const trend = [week("Wk 1", null), week("Wk 2", 40), week("Wk 3", null), week("Wk 4", null)];

  const { trend: filled } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([null, 40, 40, 40]);
});

test("fillSquadTrendGaps passes a trend with no nulls through unchanged", () => {
  const trend = [week("Wk 1", 10), week("Wk 2", 20), week("Wk 3", 30)];

  const { trend: filled, carriedIndices } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.value)).toEqual([10, 20, 30]);
  expect(carriedIndices.size).toBe(0);
});

test("fillSquadTrendGaps preserves each point's week label, only overwriting the value", () => {
  const trend = [week("Wk 1", 60), week("Wk 2", null)];

  const { trend: filled } = fillSquadTrendGaps(trend);

  expect(filled.map((point) => point.week)).toEqual(["Wk 1", "Wk 2"]);
});

test("fillSquadTrendGaps marks exactly the carried positions, not real or leading-null ones", () => {
  const trend = [
    week("Wk 1", null),
    week("Wk 2", 55),
    week("Wk 3", null),
    week("Wk 4", null),
    week("Wk 5", 70),
  ];

  const { carriedIndices } = fillSquadTrendGaps(trend);

  expect(carriedIndices).toEqual(new Set([2, 3]));
});

function style(kind: PointEnderKind, count: number): PointEnderStyle {
  return {
    kind,
    count,
    label: kind,
    detail: { court_zones: [], shot_type: [], unusual_reasons: null, wing: null },
  };
}

function pointEnderStyles(
  you: { forced: number; unforced: number },
  opponents: { forced: number; unforced: number },
): PointEnderStyles {
  return {
    you: [style("forced", you.forced), style("unforced", you.unforced), style("unusual", 0)],
    opponents: [
      style("forced", opponents.forced),
      style("unforced", opponents.unforced),
      style("unusual", 0),
    ],
  };
}

test("mistakeResilience reads the tracked player's own errors from styles.opponents (points they lost)", () => {
  const styles = pointEnderStyles({ forced: 0, unforced: 0 }, { forced: 12, unforced: 4 });

  expect(mistakeResilience(styles)).toBeCloseTo((12 / 16) * 100);
});

test("mistakeResilience is null when the player has lost no points via a recorded error yet", () => {
  const styles = pointEnderStyles({ forced: 5, unforced: 5 }, { forced: 0, unforced: 0 });

  expect(mistakeResilience(styles)).toBeNull();
});

test("mistakeResilience is 100 when every own error was forced, 0 when every one was unforced", () => {
  const allForced = pointEnderStyles({ forced: 0, unforced: 0 }, { forced: 6, unforced: 0 });
  const allUnforced = pointEnderStyles({ forced: 0, unforced: 0 }, { forced: 0, unforced: 6 });

  expect(mistakeResilience(allForced)).toBe(100);
  expect(mistakeResilience(allUnforced)).toBe(0);
});

test("aggressionScore reads the opponent's own errors from styles.you (points the tracked player won)", () => {
  const styles = pointEnderStyles({ forced: 9, unforced: 3 }, { forced: 0, unforced: 0 });

  expect(aggressionScore(styles)).toBeCloseTo((9 / 12) * 100);
});

test("aggressionScore is null when the player has won no points via a recorded error yet", () => {
  const styles = pointEnderStyles({ forced: 0, unforced: 0 }, { forced: 5, unforced: 5 });

  expect(aggressionScore(styles)).toBeNull();
});

test("aggressionScore is 100 when every opponent error was forced, 0 when every one was unforced", () => {
  const allForced = pointEnderStyles({ forced: 8, unforced: 0 }, { forced: 0, unforced: 0 });
  const allUnforced = pointEnderStyles({ forced: 0, unforced: 8 }, { forced: 0, unforced: 0 });

  expect(aggressionScore(allForced)).toBe(100);
  expect(aggressionScore(allUnforced)).toBe(0);
});

test("overallAverageRallyLength weights won/lost averages by their own point counts", () => {
  const rally = { average_rally_length: { won: 5, lost: 3 }, won: 30, lost: 10 };

  expect(overallAverageRallyLength(rally)).toBeCloseTo((5 * 30 + 3 * 10) / 40);
});

test("overallAverageRallyLength falls back to whichever side is non-null", () => {
  const wonOnly = { average_rally_length: { won: 4, lost: null }, won: 10, lost: 0 };
  const lostOnly = { average_rally_length: { won: null, lost: 6 }, won: 0, lost: 10 };

  expect(overallAverageRallyLength(wonOnly)).toBe(4);
  expect(overallAverageRallyLength(lostOnly)).toBe(6);
});

test("overallAverageRallyLength is null when neither side has a value yet", () => {
  const rally = { average_rally_length: { won: null, lost: null }, won: 0, lost: 0 };

  expect(overallAverageRallyLength(rally)).toBeNull();
});

test("overallAverageRallyLength falls back to a plain mean when point counts are both zero", () => {
  const rally = { average_rally_length: { won: 4, lost: 6 }, won: 0, lost: 0 };

  expect(overallAverageRallyLength(rally)).toBe(5);
});

test("rallyLengthSizeBucket maps a value to one of four sizes, relative to the group's own range", () => {
  expect(rallyLengthSizeBucket(2, 2, 10)).toBe("sm");
  expect(rallyLengthSizeBucket(10, 2, 10)).toBe("xl");
  expect(rallyLengthSizeBucket(6, 2, 10)).toBe("lg");
});

test("rallyLengthSizeBucket maps every value to md when the group has no spread", () => {
  expect(rallyLengthSizeBucket(5, 5, 5)).toBe("md");
});

test("scaleToGroupRange maps the group's min/max to the 10-90 padded band, not raw 0-100", () => {
  expect(scaleToGroupRange(40, 40, 60)).toBe(10);
  expect(scaleToGroupRange(60, 40, 60)).toBe(90);
  expect(scaleToGroupRange(50, 40, 60)).toBe(50);
});

test("scaleToGroupRange centers every value at 50 when the group has no spread", () => {
  expect(scaleToGroupRange(50, 50, 50)).toBe(50);
});

test("pickBestWorst returns the two ends of the entries, ranked by value", () => {
  const entries = [{ v: 10 }, { v: 30 }, { v: 20 }];

  const { best, worst } = pickBestWorst(entries, (entry) => entry.v);

  expect(best).toEqual({ v: 30 });
  expect(worst).toEqual({ v: 10 });
});

test("pickBestWorst excludes entries with a null value entirely", () => {
  const entries = [{ v: 10 }, { v: null }, { v: 20 }];

  const { best, worst } = pickBestWorst(entries, (entry) => entry.v);

  expect(best).toEqual({ v: 20 });
  expect(worst).toEqual({ v: 10 });
});

test("pickBestWorst returns both null when nothing is eligible", () => {
  const entries = [{ v: null }, { v: null }];

  const { best, worst } = pickBestWorst(entries, (entry) => entry.v);

  expect(best).toBeNull();
  expect(worst).toBeNull();
});

// A lone eligible entry (or every eligible entry tied) is `best` only —
// duplicating it as `worst` too would imply a spread that isn't there.
test("pickBestWorst never duplicates a single eligible entry as both best and worst", () => {
  const entries = [{ v: 42 }, { v: null }];

  const { best, worst } = pickBestWorst(entries, (entry) => entry.v);

  expect(best).toEqual({ v: 42 });
  expect(worst).toBeNull();
});

test("pickBestWorst never duplicates a tied group as both best and worst", () => {
  const entries = [{ v: 5 }, { v: 5 }, { v: 5 }];

  const { best, worst } = pickBestWorst(entries, (entry) => entry.v);

  expect(best).toEqual({ v: 5 });
  expect(worst).toBeNull();
});

test("periodWinPercent reads wins out of a player's period record", () => {
  expect(periodWinPercent({ wins: 3, losses: 2 })).toBeCloseTo(60);
});

test("periodWinPercent is null for a 0-0 record, not a fabricated 0%", () => {
  expect(periodWinPercent({ wins: 0, losses: 0 })).toBeNull();
});

test("periodWinPercent is 100 for an all-win record, 0 for an all-loss one", () => {
  expect(periodWinPercent({ wins: 2, losses: 0 })).toBe(100);
  expect(periodWinPercent({ wins: 0, losses: 2 })).toBe(0);
});

test("periodResiliencePercent reads a member's own period error counts as a forced share of total", () => {
  expect(
    periodResiliencePercent({ period_forced_errors_suffered: 3, period_unforced_errors: 1 }),
  ).toBeCloseTo(75);
});

test("periodResiliencePercent is null when neither count has happened yet", () => {
  expect(
    periodResiliencePercent({ period_forced_errors_suffered: 0, period_unforced_errors: 0 }),
  ).toBeNull();
});

test("periodResiliencePercent is 100 when every own error was forced, 0 when every one was unforced", () => {
  expect(
    periodResiliencePercent({ period_forced_errors_suffered: 4, period_unforced_errors: 0 }),
  ).toBe(100);
  expect(
    periodResiliencePercent({ period_forced_errors_suffered: 0, period_unforced_errors: 4 }),
  ).toBe(0);
});
