import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import {
  getMatchRallyStatsOptions,
  getMatchServeStatsOptions,
  getRallyStatsOptions,
  getRecentFormOptions,
  getServeStatsOptions,
} from "./analytics-options";

// Every screen passes `set` and `phase` explicitly today, so the defaults these
// factories declare have never actually been taken. They are what a caller reading the
// signature — `query?` — would reasonably rely on, and a key that silently changed
// shape when the argument is omitted would split the cache in two.

const PLAYER = "player-1";
const MATCH = "match-1";

test("a player's serve stats default to all sets, the full match and every opponent", () => {
  const withoutQuery = getServeStatsOptions({ path: { player_id: PLAYER } });
  const spelledOut = getServeStatsOptions({
    path: { player_id: PLAYER },
    query: { set: "all", phase: "full", opponentId: null },
  });

  expect(withoutQuery.queryKey).toEqual(["analytics", "serve", "v3", PLAYER, "all", "full", "all"]);
  expect(withoutQuery.queryKey).toEqual(spelledOut.queryKey);
});

test("a player's rally stats default the same way", () => {
  const withoutQuery = getRallyStatsOptions({ path: { player_id: PLAYER } });

  expect(withoutQuery.queryKey).toEqual(["analytics", "rally", "v3", PLAYER, "all", "full", "all"]);
});

test("a match's serve and rally stats default to all sets and the full match", () => {
  expect(getMatchServeStatsOptions({ path: { match_id: MATCH } }).queryKey).toEqual([
    "analytics",
    "match-serve",
    MATCH,
    "all",
    "full",
  ]);
  expect(getMatchRallyStatsOptions({ path: { match_id: MATCH } }).queryKey).toEqual([
    "analytics",
    "match-rally",
    MATCH,
    "all",
    "full",
  ]);
});

// Only `all` and three opponents have a fixture. The other nine resolve to null rather
// than falling back to the all-matches record, which would show one opponent's form
// under another's name.
test("an opponent with no form fixture resolves to null, not the all-matches record", async () => {
  const unknown = getRecentFormOptions({
    path: { player_id: PLAYER },
    query: { opponentId: "owen-b" },
  });

  expect(unknown.queryKey).toEqual(["analytics", "recent-form", PLAYER, "owen-b"]);
  await expect(new QueryClient().fetchQuery(unknown)).resolves.toBeNull();
});

test("no opponent selected reads the all-matches form", async () => {
  const all = getRecentFormOptions({ path: { player_id: PLAYER }, query: { opponentId: null } });

  expect(all.queryKey).toEqual(["analytics", "recent-form", PLAYER, "all"]);
  await expect(new QueryClient().fetchQuery(all)).resolves.toEqual({
    results: ["win", "win", "loss", "win", "win"],
  });
});
