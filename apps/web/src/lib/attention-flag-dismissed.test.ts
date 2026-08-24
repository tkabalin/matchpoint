import { afterEach, expect, test } from "vitest";

import { dismissAttentionFlag, isAttentionFlagDismissed } from "./attention-flag-dismissed";

afterEach(() => {
  localStorage.clear();
});

test("a flag is not dismissed until dismissAttentionFlag is called", () => {
  expect(isAttentionFlagDismissed("player-1", "hard-flag")).toBe(false);
});

test("dismissing a flag marks that exact player/tier pair as dismissed", () => {
  dismissAttentionFlag("player-1", "hard-flag");

  expect(isAttentionFlagDismissed("player-1", "hard-flag")).toBe(true);
});

test("a different tier for the same player is not considered dismissed", () => {
  dismissAttentionFlag("player-1", "hard-flag");

  expect(isAttentionFlagDismissed("player-1", "decline")).toBe(false);
});

test("the same tier for a different player is not considered dismissed", () => {
  dismissAttentionFlag("player-1", "hard-flag");

  expect(isAttentionFlagDismissed("player-2", "hard-flag")).toBe(false);
});

test("only the most recently dismissed pair is remembered", () => {
  dismissAttentionFlag("player-1", "hard-flag");
  dismissAttentionFlag("player-2", "decline");

  expect(isAttentionFlagDismissed("player-1", "hard-flag")).toBe(false);
  expect(isAttentionFlagDismissed("player-2", "decline")).toBe(true);
});
