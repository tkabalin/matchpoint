import { expect, test } from "vitest";

import { RALLY_STATS } from "./fixtures";

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
