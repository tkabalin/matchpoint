import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { outboxDb } from "./db";
import type { LoggedEvent, LoggedMatch } from "./db";
import {
  appendEvent,
  findInProgressFor,
  listInProgress,
  readLog,
  readMatch,
  removeEvent,
  removeMatch,
  saveMatch,
  watchInProgress,
} from "./match-log";

const COACH_ID = "coach-1";
const OTHER_COACH = "coach-2";
const PLAYER_ID = "player-1";
const MATCH_ID = "match-1";

beforeEach(async () => {
  await outboxDb.events.clear();
  await outboxDb.matches.clear();
});

function eventOf(sequence: number, overrides: Partial<LoggedEvent> = {}): LoggedEvent {
  return {
    id: `event-${String(sequence)}`,
    matchId: MATCH_ID,
    coachId: COACH_ID,
    sequence,
    kind: "point",
    payload: { sequence },
    ...overrides,
  };
}

function matchOf(overrides: Partial<LoggedMatch> = {}): LoggedMatch {
  return {
    matchId: MATCH_ID,
    coachId: COACH_ID,
    trackedPlayerId: PLAYER_ID,
    nextSequence: 3,
    finished: false,
    updatedAt: 1_700_000_000_000,
    payload: { matchId: MATCH_ID },
    ...overrides,
  };
}

describe("events", () => {
  test("reads back in sequence order, whatever order they were written in", async () => {
    await appendEvent(eventOf(2));
    await appendEvent(eventOf(0));
    await appendEvent(eventOf(1));

    expect((await readLog(MATCH_ID)).map((event) => event.sequence)).toEqual([0, 1, 2]);
  });

  test("only ever returns the match asked for", async () => {
    await appendEvent(eventOf(0));
    await appendEvent(eventOf(0, { id: "other", matchId: "match-2" }));

    expect(await readLog(MATCH_ID)).toHaveLength(1);
  });

  // Unlike the outbox next door, which is first-write-wins: the log holds the current
  // truth, and the same event written twice is the same event.
  test("rewriting an event under its own id overwrites rather than duplicating", async () => {
    await appendEvent(eventOf(0));
    await appendEvent(eventOf(0, { payload: { sequence: 0, note: "second" } }));

    const log = await readLog(MATCH_ID);
    expect(log).toHaveLength(1);
    expect(log[0]?.payload).toEqual({ sequence: 0, note: "second" });
  });

  test("removing one leaves the rest, which is what undo needs", async () => {
    await appendEvent(eventOf(0));
    await appendEvent(eventOf(1));

    await removeEvent("event-1");

    expect((await readLog(MATCH_ID)).map((event) => event.sequence)).toEqual([0]);
  });

  test("removing one that was never there is not an error", async () => {
    await expect(removeEvent("never-existed")).resolves.toBeUndefined();
  });
});

describe("matches", () => {
  test("saves and reads back the facts the events can't carry", async () => {
    await saveMatch(matchOf());

    const saved = await readMatch(MATCH_ID);
    expect(saved?.nextSequence).toBe(3);
    expect(saved?.finished).toBe(false);
  });

  test("saving again updates in place", async () => {
    await saveMatch(matchOf());
    await saveMatch(matchOf({ nextSequence: 9 }));

    expect(await outboxDb.matches.count()).toBe(1);
    expect((await readMatch(MATCH_ID))?.nextSequence).toBe(9);
  });

  test("lists a coach's unfinished matches, most recently touched first", async () => {
    await saveMatch(matchOf({ updatedAt: 1 }));
    await saveMatch(matchOf({ matchId: "match-2", updatedAt: 2 }));
    await saveMatch(matchOf({ matchId: "match-3", finished: true, updatedAt: 3 }));
    await saveMatch(matchOf({ matchId: "match-4", coachId: OTHER_COACH, updatedAt: 4 }));

    expect((await listInProgress(COACH_ID)).map((row) => row.matchId)).toEqual([
      "match-2",
      MATCH_ID,
    ]);
  });

  test("finds the newest unfinished match for one player, and skips a finished one", async () => {
    await saveMatch(matchOf({ updatedAt: 1 }));
    await saveMatch(matchOf({ matchId: "match-2", updatedAt: 2 }));

    expect((await findInProgressFor(COACH_ID, PLAYER_ID))?.matchId).toBe("match-2");

    await saveMatch(matchOf({ matchId: "match-2", updatedAt: 2, finished: true }));
    expect((await findInProgressFor(COACH_ID, PLAYER_ID))?.matchId).toBe(MATCH_ID);

    await saveMatch(matchOf({ updatedAt: 1, finished: true }));
    expect(await findInProgressFor(COACH_ID, PLAYER_ID)).toBeUndefined();
  });

  test("another player's match is never offered for this one", async () => {
    await saveMatch(matchOf());

    expect(await findInProgressFor(COACH_ID, "player-2")).toBeUndefined();
  });

  test("removing a match takes its events with it, and leaves other matches alone", async () => {
    await saveMatch(matchOf());
    await appendEvent(eventOf(0));
    await appendEvent(eventOf(0, { id: "other", matchId: "match-2" }));

    await removeMatch(MATCH_ID);

    expect(await readMatch(MATCH_ID)).toBeUndefined();
    expect(await readLog(MATCH_ID)).toEqual([]);
    expect(await readLog("match-2")).toHaveLength(1);
  });
});

describe("watchInProgress", () => {
  const subscriptions: { unsubscribe: () => void }[] = [];

  // In teardown, not at the end of each test: a failing `waitFor` above would
  // otherwise leave the subscription live for the rest of the file, the same
  // reasoning outbox.test.ts's own watchCounts suite gives.
  afterEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
  });

  function watch(coachId: string): LoggedMatch[][] {
    const seen: LoggedMatch[][] = [];
    subscriptions.push(watchInProgress(coachId).subscribe((rows) => seen.push(rows)));
    return seen;
  }

  test("emits this coach's unfinished matches as the log changes, freshest first", async () => {
    const seen = watch(COACH_ID);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));

    await saveMatch(matchOf({ updatedAt: 1 }));
    await vi.waitFor(() => expect(seen.at(-1)?.map((row) => row.matchId)).toEqual([MATCH_ID]));

    await saveMatch(matchOf({ matchId: "match-2", updatedAt: 2 }));
    await vi.waitFor(() =>
      expect(seen.at(-1)?.map((row) => row.matchId)).toEqual(["match-2", MATCH_ID]),
    );
  });

  test("drops a match once it's marked finished, live", async () => {
    await saveMatch(matchOf());
    const seen = watch(COACH_ID);
    await vi.waitFor(() => expect(seen.at(-1)).toHaveLength(1));

    await saveMatch(matchOf({ finished: true }));

    await vi.waitFor(() => expect(seen.at(-1)).toEqual([]));
  });

  test("never emits another coach's matches", async () => {
    await saveMatch(matchOf({ coachId: OTHER_COACH }));
    const seen = watch(COACH_ID);

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)).toEqual([]);
  });
});
