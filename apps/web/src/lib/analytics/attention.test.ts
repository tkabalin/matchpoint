import { expect, test } from "vitest";

import { attentionFor, pickSquadAttention, rankForm } from "./attention";
import type { SquadMemberStats } from "./types.provisional";

function member(overrides: Partial<SquadMemberStats> = {}): SquadMemberStats {
  return {
    playerId: "player-1",
    matchesLoggedThisPeriod: 6,
    last5: ["win", "win", "loss", "win", "win"],
    forcedToUnforcedRatio: 1.5,
    currentStreak: { outcome: "win", length: 1 },
    daysSinceLastMatch: 2,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 64,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
    ...overrides,
  };
}

test("no flag when nothing crosses either tier", () => {
  expect(attentionFor(member())).toBeNull();
});

test("Tier 1 fires on a losing streak at the threshold", () => {
  const flagged = member({ currentStreak: { outcome: "loss", length: 3 } });

  const result = attentionFor(flagged);

  expect(result).toEqual({
    playerId: "player-1",
    tier: "hard-flag",
    reason: "3-match losing streak",
    severity: Infinity,
  });
});

test("a losing streak below the threshold does not fire", () => {
  const notFlagged = member({ currentStreak: { outcome: "loss", length: 2 } });

  expect(attentionFor(notFlagged)).toBeNull();
});

test("Tier 1 fires on stale data at 14+ days, even mid win-streak", () => {
  const flagged = member({
    currentStreak: { outcome: "win", length: 4 },
    daysSinceLastMatch: 14,
  });

  const result = attentionFor(flagged);

  expect(result?.reason).toBe("No matches logged in 14+ days");
  expect(result?.severity).toBe(Infinity);
});

test("Tier 1 fires when the player has never logged a match", () => {
  const flagged = member({ daysSinceLastMatch: null });

  expect(attentionFor(flagged)?.reason).toBe("No matches logged in 14+ days");
});

test("Tier 2 requires the minimum sample before it can fire", () => {
  const belowSample = member({
    matchesLoggedThisPeriod: 4,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 40,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  });

  expect(attentionFor(belowSample)).toBeNull();
});

test("Tier 2 requires the minimum severity before it can fire", () => {
  const mildDip = member({
    matchesLoggedThisPeriod: 6,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 61,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  });

  // z = (61 - 64) / 5 = -0.6, short of the -1.5 threshold.
  expect(attentionFor(mildDip)).toBeNull();
});

test("Tier 2 fires on a genuine decline vs. the player's own baseline, in points for a percent stat", () => {
  const declined = member({
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 46,
        rollingMean: 64,
        rollingStdDev: 6,
      },
    ],
  });

  const result = attentionFor(declined);

  // z = (46 - 64) / 6 = -3.
  expect(result).toEqual({
    playerId: "player-1",
    tier: "decline",
    reason: "1st serve % in down 18pts vs their own average",
    severity: 3,
  });
});

test("Tier 2 formats a ratio stat's decline as a decimal, not points", () => {
  const declined = member({
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 0.8,
        rollingMean: 1.5,
        rollingStdDev: 0.35,
      },
    ],
  });

  expect(attentionFor(declined)?.reason).toBe(
    "Forced : Unforced ratio down 0.7 vs their own average",
  );
});

test("Tier 2 picks the single worst-declining stat, not the first one listed", () => {
  const declined = member({
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "forcedToUnforced",
        label: "Forced : Unforced ratio",
        unit: "ratio",
        current: 1.3,
        rollingMean: 1.5,
        rollingStdDev: 0.4,
      },
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 40,
        rollingMean: 64,
        rollingStdDev: 6,
      },
    ],
  });

  // z(forced:unforced) = -0.5, z(1st serve) = -4 — the second stat is the real story.
  expect(attentionFor(declined)?.reason).toBe("1st serve % in down 24pts vs their own average");
});

test("a stat with zero spread can't be deviated from, and is skipped", () => {
  const flat = member({
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 40,
        rollingMean: 64,
        rollingStdDev: 0,
      },
    ],
  });

  expect(attentionFor(flat)).toBeNull();
});

test("Tier 1 always outranks Tier 2 across the squad", () => {
  const hardFlagged = member({
    playerId: "hard-flag-player",
    currentStreak: { outcome: "loss", length: 3 },
    daysSinceLastMatch: 10,
  });
  const declined = member({
    playerId: "decline-player",
    matchesLoggedThisPeriod: 7,
    daysSinceLastMatch: 1,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 30,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  });

  const winner = pickSquadAttention([declined, hardFlagged]);

  expect(winner?.playerId).toBe("hard-flag-player");
});

test("within Tier 2, the larger |z| wins", () => {
  const milderDecline = member({
    playerId: "mild",
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 55,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  });
  const sharperDecline = member({
    playerId: "sharp",
    matchesLoggedThisPeriod: 7,
    trackedStats: [
      {
        key: "firstServeIn",
        label: "1st serve % in",
        unit: "percent",
        current: 30,
        rollingMean: 64,
        rollingStdDev: 5,
      },
    ],
  });

  expect(pickSquadAttention([milderDecline, sharperDecline])?.playerId).toBe("sharp");
});

test("ties break by recency, most recent match wins", () => {
  const stale = member({
    playerId: "stale",
    currentStreak: { outcome: "loss", length: 3 },
    daysSinceLastMatch: 12,
  });
  const fresh = member({
    playerId: "fresh",
    currentStreak: { outcome: "loss", length: 3 },
    daysSinceLastMatch: 1,
  });

  expect(pickSquadAttention([stale, fresh])?.playerId).toBe("fresh");
});

test("nobody flagged is a legitimate result, not a fallback to the least-bad player", () => {
  expect(pickSquadAttention([member(), member({ playerId: "player-2" })])).toBeNull();
});

test("rankForm excludes players below the minimum sample for a fair ranking", () => {
  const tooFew = member({ playerId: "too-few", matchesLoggedThisPeriod: 2 });
  const eligible = member({ playerId: "eligible", matchesLoggedThisPeriod: 3 });

  const { best, worst } = rankForm([tooFew, eligible]);

  expect(best?.playerId).toBe("eligible");
  expect(worst).toBeNull();
});

test("rankForm returns the highest and lowest forced:unforced ratio", () => {
  const top = member({ playerId: "top", forcedToUnforcedRatio: 2.4, last5: ["win", "win", "win"] });
  const middle = member({ playerId: "middle", forcedToUnforcedRatio: 1.2 });
  const bottom = member({
    playerId: "bottom",
    forcedToUnforcedRatio: 0.5,
    last5: ["loss", "loss"],
  });

  const { best, worst } = rankForm([middle, top, bottom]);

  expect(best).toEqual({ playerId: "top", last5Record: "3W – 0L", forcedToUnforcedRatio: 2.4 });
  expect(worst).toEqual({ playerId: "bottom", last5Record: "0W – 2L", forcedToUnforcedRatio: 0.5 });
});

test("rankForm shows a single eligible player once, not as both best and worst", () => {
  const onlyOne = member({ playerId: "solo" });

  const { best, worst } = rankForm([onlyOne]);

  expect(best?.playerId).toBe("solo");
  expect(worst).toBeNull();
});

test("rankForm returns nulls when nobody has enough matches logged", () => {
  const { best, worst } = rankForm([member({ matchesLoggedThisPeriod: 1 })]);

  expect(best).toBeNull();
  expect(worst).toBeNull();
});
