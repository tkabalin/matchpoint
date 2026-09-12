import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";

import { getLastViewedPlayerId, setLastViewedPlayerId } from "./last-viewed-player";
import {
  clearCachedReads,
  getRecordedOwnerKind,
  purgeIfOwnerChanged,
  purgeLocalData,
  recordOwnerIfUnknown,
} from "./local-data";
import { queryPersistOptions, removePersistedQueryCache } from "./query-persist";

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const OTHER_COACH_ID = "c0ac0000-0000-4000-8000-000000000002";
const PLAYER_ID = "31aye000-0000-4000-8000-000000000001";

/** A queued point of this coach's, of the kind only a drain may take off the device. */
async function queuePoint() {
  await append({
    id: "3f1c2b4e-0000-4000-8000-0000000000a1",
    coachId: COACH_ID,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
}

/** A client holding a cached roster, plus the IndexedDB copy that outlives the tab. */
async function cacheRoster() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["players"], [{ id: "p1", full_name: "Amahle Nkosi" }]);
  await queryPersistOptions.persister.persistClient({
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: dehydrate(queryClient),
  });
  return queryClient;
}

// Deleting and reopening rather than clearing: the same reasoning as outbox.test.ts,
// and it is also what proves a purged database is usable again afterwards.
beforeEach(async () => {
  localStorage.clear();
  await outboxDb.delete();
  await outboxDb.open();
});

afterEach(async () => {
  await removePersistedQueryCache();
});

test("clearing cached reads empties both copies of the cache", async () => {
  const queryClient = await cacheRoster();

  await clearCachedReads(queryClient);

  expect(queryClient.getQueryData(["players"])).toBeUndefined();
  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();
});

test("clearing cached reads leaves queued points alone", async () => {
  await queuePoint();

  await clearCachedReads(new QueryClient());

  // The half of #117 a revoked session must not break: reads come back from the
  // server, a point captured courtside and never sent comes back from nowhere.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("purging deletes the queued points as well as the cache", async () => {
  const queryClient = await cacheRoster();
  await queuePoint();

  await purgeLocalData(queryClient);

  expect(queryClient.getQueryData(["players"])).toBeUndefined();
  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();
  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("leaves the outbox usable once it has been purged", async () => {
  await queuePoint();

  await purgeLocalData(new QueryClient());
  await queuePoint();

  // Dexie refuses to reopen a database deleted with its default options, which would
  // strand the next coach signing in on this device with an outbox that cannot append.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("purges when the coach signing in is not the one the device's data belongs to", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint();

  await purgeIfOwnerChanged(OTHER_COACH_ID, new QueryClient(), "coach");

  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("keeps the queue when the same coach signs in again", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint();

  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");

  // A session revoked server-side leaves the ownership record in place, so this is
  // the path a coach takes back to the points they captured before it died.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("a cleared read cache still knows whose device this is", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint();

  await clearCachedReads(new QueryClient());
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");

  // The ownership record has to outlive a revoked session, or the coach signing back
  // in reads as a stranger and the points they captured courtside go with the purge.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("purging forgets the player the device was last showing", async () => {
  setLastViewedPlayerId("3f1c2b4e-0000-4000-8000-000000000001");

  await clearCachedReads(new QueryClient());
  expect(getLastViewedPlayerId()).not.toBeNull();
  await purgeLocalData(new QueryClient());

  // The id only ever 404s for the next coach, players being coach-scoped server-side,
  // but it is still one coach's player id on a device that is now someone else's.
  expect(getLastViewedPlayerId()).toBeNull();
});

test("purges a device that cannot say whose data it holds", async () => {
  await queuePoint();

  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");

  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("a confirmed session claims a device nothing else has claimed", async () => {
  recordOwnerIfUnknown(COACH_ID, "coach");
  await queuePoint();

  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");

  // Otherwise a session older than the ownership record costs its own coach the
  // points they captured, the first time they sign in again.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("a confirmed session never re-claims a device that has an owner", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint();

  // The guard can be handed a coach it read from the cache, so it is in no position
  // to say a switch happened. Only a sign-in moves the record.
  recordOwnerIfUnknown(OTHER_COACH_ID, "coach");
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");

  expect(await readPending(COACH_ID)).toHaveLength(1);
});

// #257/#203: `/`'s own guard needs to know which kind of principal a recorded owner
// is, to guess between /home and /me offline — see index.tsx's own comment.
test("no owner kind is recorded until one signs in or a guard confirms one", () => {
  expect(getRecordedOwnerKind()).toBeNull();
});

test("records the owner's kind alongside its id on sign-in", async () => {
  await purgeIfOwnerChanged(PLAYER_ID, new QueryClient(), "player");

  expect(getRecordedOwnerKind()).toBe("player");
});

test("records the owner's kind on a route guard's first confirmed session, same as the id", () => {
  recordOwnerIfUnknown(PLAYER_ID, "player");

  expect(getRecordedOwnerKind()).toBe("player");
});

test("never overwrites a recorded kind any more than it overwrites the id", () => {
  recordOwnerIfUnknown(COACH_ID, "coach");

  recordOwnerIfUnknown(PLAYER_ID, "player");

  expect(getRecordedOwnerKind()).toBe("coach");
});

test("purging forgets the owner's kind along with everything else", async () => {
  await purgeIfOwnerChanged(PLAYER_ID, new QueryClient(), "player");

  await purgeLocalData(new QueryClient());

  expect(getRecordedOwnerKind()).toBeNull();
});
