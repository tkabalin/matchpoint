import type { SquadMemberStats } from "@matchpoint/api-client";
import { expect, test } from "vitest";

import { attentionFor, pickSquadAttention } from "./attention";

function member(overrides: Partial<SquadMemberStats> = {}): SquadMemberStats {
  return {
    player_id: "player-1",
    matches_logged_this_period: 6,
    last5_results: ["win", "win", "loss", "win", "win"],
    period_forced_to_unforced_ratio: 1.5,
    period_forced_errors_induced: 30,
    period_unforced_errors: 20,
    period_forced_errors_suffered: 20,
    period_points_won: 100,
    period_points_lost: 90,
    period_first_serve_in_percent: 64,
    period_record: { wins: 4, losses: 2 },
    current_streak: { outcome: "win", length: 1 },
    days_since_last_match: 2,
    last5_stats: {
      first_serve_in_percent: 64,
      return_in_percent: 70,
      forced_to_unforced_ratio: 1.5,
      forced_errors_induced: 18,
      unforced_errors: 12,
      forced_errors_suffered: 8,
      points_won: 40,
      points_lost: 35,
    },
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 64,
        rolling_mean: 64,
        rolling_std_dev: 5,
      },
    ],
    ...overrides,
  };
}

test("no flag when nothing crosses either tier", () => {
  expect(attentionFor(member())).toBeNull();
});

test("Tier 1 fires on a losing streak at the threshold", () => {
  const flagged = member({ current_streak: { outcome: "loss", length: 3 } });

  const result = attentionFor(flagged);

  expect(result).toEqual({
    playerId: "player-1",
    tier: "hard-flag",
    reason: "3-match losing streak",
    severity: Infinity,
  });
});

test("a losing streak below the threshold does not fire", () => {
  const notFlagged = member({ current_streak: { outcome: "loss", length: 2 } });

  expect(attentionFor(notFlagged)).toBeNull();
});

test("Tier 1 no longer hard-flags on elapsed days alone, even well past two weeks", () => {
  const notFlagged = member({
    current_streak: { outcome: "win", length: 4 },
    days_since_last_match: 30,
  });

  expect(attentionFor(notFlagged)).toBeNull();
});

test("Tier 1 states a player has never logged a match", () => {
  const flagged = member({ days_since_last_match: null });

  expect(attentionFor(flagged)?.reason).toBe("No matches logged yet");
  expect(attentionFor(flagged)?.severity).toBe(Infinity);
});

// The old gate compared `matches_logged_this_period` (a calendar-year count
// that resets every January 1st) against a minimum sample, which silently
// killed Tier 2 for the first few matches of every year regardless of a
// player's real history. `tracked_stats` already only carries a stat with a
// real baseline behind it, so nothing else needs to gate on the period count.
test("Tier 2 can still fire just after the calendar year turns over (#238)", () => {
  const earlyJanuary = member({
    matches_logged_this_period: 1,
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 46,
        rolling_mean: 64,
        rolling_std_dev: 6,
      },
    ],
  });

  const result = attentionFor(earlyJanuary);

  expect(result?.tier).toBe("decline");
});

test("Tier 2 requires the minimum severity before it can fire", () => {
  const mildDip = member({
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 61,
        rolling_mean: 64,
        rolling_std_dev: 5,
      },
    ],
  });

  // z = (61 - 64) / 5 = -0.6, short of the -1.5 threshold.
  expect(attentionFor(mildDip)).toBeNull();
});

test("Tier 2 fires on a genuine decline vs. the player's own baseline, in points for a percent stat", () => {
  const declined = member({
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 46,
        rolling_mean: 64,
        rolling_std_dev: 6,
      },
    ],
  });

  const result = attentionFor(declined);

  // z = (46 - 64) / 6 = -3.
  expect(result).toEqual({
    playerId: "player-1",
    tier: "decline",
    reason: "1st serve in % down 18pts vs their own average",
    severity: 3,
  });
});

test("Tier 2 formats a ratio stat's decline as a decimal, not points", () => {
  const declined = member({
    tracked_stats: [
      {
        key: "forced_to_unforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 0.8,
        rolling_mean: 1.5,
        rolling_std_dev: 0.35,
      },
    ],
  });

  expect(attentionFor(declined)?.reason).toBe(
    "Forced : Unforced ratio down 0.7 vs their own average",
  );
});

test("Tier 2 picks the single worst-declining stat, not the first one listed", () => {
  const declined = member({
    tracked_stats: [
      {
        key: "forced_to_unforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 1.3,
        rolling_mean: 1.5,
        rolling_std_dev: 0.4,
      },
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 40,
        rolling_mean: 64,
        rolling_std_dev: 6,
      },
    ],
  });

  // z(forced:unforced) = -0.5, z(1st serve) = -4 — the second stat is the real story.
  expect(attentionFor(declined)?.reason).toBe("1st serve in % down 24pts vs their own average");
});

test("a stat with zero spread can't be deviated from, and is skipped", () => {
  const flat = member({
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 40,
        rolling_mean: 64,
        rolling_std_dev: 0,
      },
    ],
  });

  expect(attentionFor(flat)).toBeNull();
});

test("Tier 1 always outranks Tier 2 across the squad", () => {
  const hardFlagged = member({
    player_id: "hard-flag-player",
    current_streak: { outcome: "loss", length: 3 },
    days_since_last_match: 10,
  });
  const declined = member({
    player_id: "decline-player",
    days_since_last_match: 1,
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 30,
        rolling_mean: 64,
        rolling_std_dev: 5,
      },
    ],
  });

  const winner = pickSquadAttention([declined, hardFlagged]);

  expect(winner?.playerId).toBe("hard-flag-player");
});

test("within Tier 2, the larger |z| wins", () => {
  const milderDecline = member({
    player_id: "mild",
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 55,
        rolling_mean: 64,
        rolling_std_dev: 5,
      },
    ],
  });
  const sharperDecline = member({
    player_id: "sharp",
    tracked_stats: [
      {
        key: "first_serve_in",
        label: "1st serve in %",
        unit: "percent",
        current: 30,
        rolling_mean: 64,
        rolling_std_dev: 5,
      },
    ],
  });

  expect(pickSquadAttention([milderDecline, sharperDecline])?.playerId).toBe("sharp");
});

test("ties break by recency, most recent match wins", () => {
  const stale = member({
    player_id: "stale",
    current_streak: { outcome: "loss", length: 3 },
    days_since_last_match: 12,
  });
  const fresh = member({
    player_id: "fresh",
    current_streak: { outcome: "loss", length: 3 },
    days_since_last_match: 1,
  });

  expect(pickSquadAttention([stale, fresh])?.playerId).toBe("fresh");
});

test("nobody flagged is a legitimate result, not a fallback to the least-bad player", () => {
  expect(pickSquadAttention([member(), member({ player_id: "player-2" })])).toBeNull();
});
