import { expect, test } from "vitest";

import { RALLY_STATS, SERVE_STATS, rallyStatsFor, serveStatsFor } from "./fixtures";

// This screen gets screenshotted for the client, and its numbers used to not
// add up: the style-card counts fell well short of `won`/`lost`, the hero
// ratio didn't match the forced/unforced counts it's supposed to summarize,
// and only the rally-length histogram happened to sum correctly. Locks the
// reconciliation in so a future fixture edit can't quietly break it again.
test("the Rally tab's style-card counts sum to won and lost", () => {
  const youTotal = RALLY_STATS.styles.you.reduce((sum, style) => sum + style.count, 0);
  const opponentsTotal = RALLY_STATS.styles.opponents.reduce((sum, style) => sum + style.count, 0);

  expect(youTotal).toBe(RALLY_STATS.won);
  expect(opponentsTotal).toBe(RALLY_STATS.lost);
});

test("the hero ratio matches the combined forced and unforced counts", () => {
  const forced = ["you", "opponents"].reduce(
    (sum, side) =>
      sum + RALLY_STATS.styles[side as "you" | "opponents"].find((s) => s.kind === "forced")!.count,
    0,
  );
  const unforced = ["you", "opponents"].reduce(
    (sum, side) =>
      sum +
      RALLY_STATS.styles[side as "you" | "opponents"].find((s) => s.kind === "unforced")!.count,
    0,
  );

  expect(Math.round((forced / unforced) * 10) / 10).toBe(RALLY_STATS.hero.value);
});

test("the rally-length histogram sums to won plus lost", () => {
  const total = RALLY_STATS.rallyLength.reduce((sum, bucket) => sum + bucket.count, 0);

  expect(total).toBe(RALLY_STATS.won + RALLY_STATS.lost);
});

test("rallyStatsFor returns the base fixture for the default filter", () => {
  expect(rallyStatsFor({ set: "all", phase: "full" })).toBe(RALLY_STATS);
});

test("rallyStatsFor scales won/lost/hero together, so they stay reconciled", () => {
  const variant = rallyStatsFor({ set: "1", phase: "full" });

  const youTotal = variant.styles.you.reduce((sum, style) => sum + style.count, 0);
  const opponentsTotal = variant.styles.opponents.reduce((sum, style) => sum + style.count, 0);
  expect(youTotal).toBe(variant.won);
  expect(opponentsTotal).toBe(variant.lost);

  const forced =
    variant.styles.you.find((style) => style.kind === "forced")!.count +
    variant.styles.opponents.find((style) => style.kind === "forced")!.count;
  const unforced =
    variant.styles.you.find((style) => style.kind === "unforced")!.count +
    variant.styles.opponents.find((style) => style.kind === "unforced")!.count;
  expect(Math.round((forced / unforced) * 10) / 10).toBe(variant.hero.value);

  // A real difference from the base — the whole point of the filter.
  expect(variant.won).not.toBe(RALLY_STATS.won);
});

test("rallyStatsFor never produces a negative count from a small scale", () => {
  const variant = rallyStatsFor({ set: "1", phase: "match_points", scale: 0.01 });

  for (const side of ["you", "opponents"] as const) {
    for (const style of variant.styles[side]) {
      expect(style.count).toBeGreaterThanOrEqual(0);
    }
  }
  expect(variant.won).toBeGreaterThanOrEqual(0);
  expect(variant.lost).toBeGreaterThanOrEqual(0);
});

test("serveStatsFor returns the base fixture for the default filter", () => {
  expect(serveStatsFor({ set: "all", phase: "full" })).toBe(SERVE_STATS);
});

test("serveStatsFor's outcome triples still sum to 100 after scaling", () => {
  const variant = serveStatsFor({ set: "2", phase: "tiebreaks", opponentId: "sarah-k" });

  for (const side of [variant.serving, variant.returning]) {
    for (const outcome of [side.outcome.firstServe, side.outcome.secondServe]) {
      // A half is null once that serve number was never attempted; the invariant
      // is about the halves that carry shares, not about inventing one that doesn't.
      expect(outcome).not.toBeNull();
      expect(outcome!.in + outcome!.fault + outcome!.ace).toBe(100);
    }
  }
});

test("serveStatsFor is deterministic per opponent, not random", () => {
  const first = serveStatsFor({ set: "all", phase: "full", opponentId: "sarah-k" });
  const second = serveStatsFor({ set: "all", phase: "full", opponentId: "sarah-k" });

  expect(second).toEqual(first);
});
