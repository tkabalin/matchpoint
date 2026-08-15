import { afterEach, expect, test } from "vitest";

import { getLastViewedPlayerId, setLastViewedPlayerId } from "./last-viewed-player";

afterEach(() => {
  localStorage.clear();
});

test("returns null when nothing has been viewed yet", () => {
  expect(getLastViewedPlayerId()).toBeNull();
});

test("returns the id most recently set", () => {
  setLastViewedPlayerId("player-1");
  expect(getLastViewedPlayerId()).toBe("player-1");

  setLastViewedPlayerId("player-2");
  expect(getLastViewedPlayerId()).toBe("player-2");
});
