import { QueryClient, dehydrate } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";

import { getLastViewedPlayerId, setLastViewedPlayerId } from "./last-viewed-player";
import {
  clearCachedReads,
  purgeIfCoachChanged,
  purgeLocalData,
  recordOwnerIfUnknown,
} from "./local-data";
import { queryPersistOptions, removePersistedQueryCache } from "./query-persist";

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const OTHER_COACH_ID = "c0ac0000-0000-4000-8000-000000000002";

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
  await purgeIfCoachChanged(COACH_ID, new QueryClient());
  await queuePoint();

  await purgeIfCoachChanged(OTHER_COACH_ID, new QueryClient());

  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("keeps the queue when the same coach signs in again", async () => {
  await purgeIfCoachChanged(COACH_ID, new QueryClient());
  await queuePoint();

  await purgeIfCoachChanged(COACH_ID, new QueryClient());

  // A session revoked server-side leaves the ownership record in place, so this is
  // the path a coach takes back to the points they captured before it died.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("a cleared read cache still knows whose device this is", async () => {
  await purgeIfCoachChanged(COACH_ID, new QueryClient());
  await queuePoint();

  await clearCachedReads(new QueryClient());
  await purgeIfCoachChanged(COACH_ID, new QueryClient());

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

  await purgeIfCoachChanged(COACH_ID, new QueryClient());

  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("a confirmed session claims a device nothing else has claimed", async () => {
  recordOwnerIfUnknown(COACH_ID);
  await queuePoint();

  await purgeIfCoachChanged(COACH_ID, new QueryClient());

  // Otherwise a session older than the ownership record costs its own coach the
  // points they captured, the first time they sign in again.
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("a confirmed session never re-claims a device that has an owner", async () => {
  await purgeIfCoachChanged(COACH_ID, new QueryClient());
  await queuePoint();

  // The guard can be handed a coach it read from the cache, so it is in no position
  // to say a switch happened. Only a sign-in moves the record.
  recordOwnerIfUnknown(OTHER_COACH_ID);
  await purgeIfCoachChanged(COACH_ID, new QueryClient());

  expect(await readPending(COACH_ID)).toHaveLength(1);
});
