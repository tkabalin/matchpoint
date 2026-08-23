import { afterEach, expect, test } from "vitest";

import {
  getLastViewedAt,
  getLastViewedPlayerId,
  setLastViewedPlayerId,
} from "./last-viewed-player";

afterEach(() => {
  localStorage.clear();
});

test("returns null when nothing has been viewed yet", () => {
  expect(getLastViewedPlayerId()).toBeNull();
  expect(getLastViewedAt()).toBeNull();
});

test("returns the id most recently set", () => {
  setLastViewedPlayerId("player-1");
  expect(getLastViewedPlayerId()).toBe("player-1");

  setLastViewedPlayerId("player-2");
  expect(getLastViewedPlayerId()).toBe("player-2");
});

test("records when the player was set as last-viewed", () => {
  const before = Date.now();
  setLastViewedPlayerId("player-1");
  const after = Date.now();

  const viewedAt = getLastViewedAt();
  expect(viewedAt).not.toBeNull();
  expect(viewedAt!).toBeGreaterThanOrEqual(before);
  expect(viewedAt!).toBeLessThanOrEqual(after);
});

test("a pre-timestamp plain-string value reads as null rather than throwing", () => {
  localStorage.setItem("matchpoint:last-viewed-player", "player-1");

  expect(getLastViewedPlayerId()).toBeNull();
  expect(getLastViewedAt()).toBeNull();
});
