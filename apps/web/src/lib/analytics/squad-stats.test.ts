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

  // "record" displays the win % it sorts by, not the "W–L" string — showing
  // both risked disagreeing (a 3–2 player can outrank a displayed 5–5 one).
  expect(metricDisplay(alex, "record")).toBe("80%");
  expect(metricDisplay(alex, "forcedToUnforced")).toBe("1.60");
  expect(metricDisplay(alex, "firstServe")).toBe("68%");
});

test("metricDisplay shows an em dash for a metric that isn't computable yet", () => {
  const noRatioYet: Named = { ...alex, forcedToUnforcedRatio: null };

  expect(metricDisplay(noRatioYet, "forcedToUnforced")).toBe("—");
});

test("squadHeadline sums wins/losses, and weighs each player's rate by their own match count", () => {
  const headline = squadHeadline([alex, priya]);

  expect(headline.record).toEqual({ wins: 9, losses: 10 });
  expect(headline.forcedToUnforcedRatio).toBeCloseTo(
    (1.6 * alex.matchesLoggedThisPeriod + 0.9 * priya.matchesLoggedThisPeriod) /
      (alex.matchesLoggedThisPeriod + priya.matchesLoggedThisPeriod),
  );
  expect(headline.firstServeInPercent).toBeCloseTo(
    (68 * alex.matchesLoggedThisPeriod + 46 * priya.matchesLoggedThisPeriod) /
      (alex.matchesLoggedThisPeriod + priya.matchesLoggedThisPeriod),
  );
  expect(headline.matchesThisPeriod).toBe(
    alex.matchesLoggedThisPeriod + priya.matchesLoggedThisPeriod,
  );
});

test("squadHeadline excludes a null rate from the average rather than counting it as zero", () => {
  const noRatioYet: Named = { ...rookie, forcedToUnforcedRatio: null };

  const headline = squadHeadline([alex, noRatioYet]);

  expect(headline.forcedToUnforcedRatio).toBe(alex.forcedToUnforcedRatio);
});

test("squadHeadline returns a zeroed record and null rates for an empty squad", () => {
  const headline = squadHeadline([]);

  expect(headline.record).toEqual({ wins: 0, losses: 0 });
  expect(headline.forcedToUnforcedRatio).toBeNull();
  expect(headline.firstServeInPercent).toBeNull();
  expect(headline.matchesThisPeriod).toBe(0);
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
