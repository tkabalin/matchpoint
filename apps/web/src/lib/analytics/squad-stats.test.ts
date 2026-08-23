import { expect, test } from "vitest";

import { squadStatsFor, squadTrendFor } from "./fixtures";
import {
  buildHistogram,
  buildLeaderboard,
  metricDisplay,
  metricValue,
  squadHeadline,
} from "./squad-stats";
import type { SquadStatsEntry } from "./types.provisional";

type Named = SquadStatsEntry & { name: string };

const alex: Named = {
  playerId: "alex",
  name: "Alex Chen",
  wins: 8,
  losses: 2,
  forcedToUnforcedRatio: 1.6,
  firstServeInPercent: 68,
  matchesLoggedThisPeriod: 10,
};
const priya: Named = {
  playerId: "priya",
  name: "Priya Singh",
  wins: 1,
  losses: 8,
  forcedToUnforcedRatio: 0.9,
  firstServeInPercent: 46,
  matchesLoggedThisPeriod: 9,
};
const rookie: Named = {
  playerId: "rookie",
  name: "Rookie Reed",
  wins: 1,
  losses: 0,
  forcedToUnforcedRatio: 1.0,
  firstServeInPercent: 55,
  matchesLoggedThisPeriod: 1,
};

test("metricValue and metricDisplay resolve each metric key", () => {
  expect(metricValue(alex, "record")).toBeCloseTo(80);
  expect(metricValue(alex, "forcedToUnforced")).toBe(1.6);
  expect(metricValue(alex, "firstServe")).toBe(68);

  expect(metricDisplay(alex, "record")).toBe("8–2");
  expect(metricDisplay(alex, "forcedToUnforced")).toBe("1.60");
  expect(metricDisplay(alex, "firstServe")).toBe("68%");
});

test("squadHeadline sums wins/losses rather than averaging win percentages", () => {
  const headline = squadHeadline([alex, priya]);

  expect(headline.record).toEqual({ wins: 9, losses: 10 });
  expect(headline.forcedToUnforcedRatio).toBeCloseTo((1.6 + 0.9) / 2);
  expect(headline.firstServeInPercent).toBeCloseTo((68 + 46) / 2);
});

test("squadHeadline returns a zeroed record for an empty squad", () => {
  const headline = squadHeadline([]);

  expect(headline.record).toEqual({ wins: 0, losses: 0 });
  expect(headline.forcedToUnforcedRatio).toBe(0);
  expect(headline.firstServeInPercent).toBe(0);
});

test("buildLeaderboard ranks eligible players by the selected metric, sub-threshold players unranked", () => {
  const rows = buildLeaderboard([alex, priya, rookie], "record", "");

  expect(rows.map((row) => row.name)).toEqual(["Alex Chen", "Priya Singh", "Rookie Reed"]);
  expect(rows[0]).toMatchObject({ rank: 1, metricValue: 80 });
  expect(rows[1]).toMatchObject({ rank: 2 });
  expect(rows[2]).toMatchObject({ rank: null, metricValue: null, matchesLoggedThisPeriod: 1 });
});

test("buildLeaderboard reorders when the metric key changes", () => {
  const byForced = buildLeaderboard([alex, priya], "forcedToUnforced", "");

  expect(byForced.map((row) => row.name)).toEqual(["Alex Chen", "Priya Singh"]);
});

test("buildLeaderboard filters both ranked and unranked groups by search", () => {
  const rows = buildLeaderboard([alex, priya, rookie], "record", "priya");

  expect(rows).toHaveLength(1);
  expect(rows[0]!.name).toBe("Priya Singh");
});

test("buildHistogram always returns 5 buckets summing to the ranked-entry count", () => {
  const buckets = buildHistogram([alex, priya], "record");

  expect(buckets).toHaveLength(5);
  expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
});

test("buildHistogram doesn't divide by zero when every value is equal", () => {
  const same = { ...alex, playerId: "same", forcedToUnforcedRatio: 1.6 };
  const buckets = buildHistogram([alex, same], "forcedToUnforced");

  expect(buckets).toHaveLength(5);
  expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
});

test("buildHistogram returns no buckets for an empty ranked set", () => {
  expect(buildHistogram([], "record")).toEqual([]);
});

test("squadStatsFor and squadTrendFor are deterministic, not random", () => {
  expect(squadStatsFor("p1", 0)).toEqual(squadStatsFor("p1", 0));
  expect(squadStatsFor("p1", 0).playerId).toBe("p1");
  expect(squadTrendFor("record")).toEqual(squadTrendFor("record"));
});

test("squadStatsFor round-robins fixture templates by roster index", () => {
  const first = squadStatsFor("a", 0);
  const wrapped = squadStatsFor("a", 6); // same template as index 0, since there are 6 templates

  expect(wrapped).toEqual(first);
});
