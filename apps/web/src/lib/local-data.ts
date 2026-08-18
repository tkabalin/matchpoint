/**
 * What this device keeps for a coach, and the two different ways it goes away.
 *
 * Both stores live here rather than at each call site because the difference between
 * them is the subtle part: cached reads can always be fetched again, so a revoked
 * session drops them, while the outbox holds points the server has never seen and
 * only an explicit sign-out or a coach switch may delete it.
 */

import type { QueryClient } from "@tanstack/react-query";

import { deleteOutboxDatabase } from "@/features/outbox/outbox";

import { clearLastViewedPlayerId } from "./last-viewed-player";
import { removePersistedQueryCache } from "./query-persist";

/**
 * Which coach the data on this device belongs to. Deliberately outlives a 401: it is
 * what lets the next sign-in tell "the same coach, whose queued points are still
 * theirs" from "someone else, purge before anything of the previous coach's renders".
 */
const OWNER_KEY = "matchpoint:local-data-owner";

/**
 * Drops every cached read, in memory and in the IndexedDB copy behind it, and leaves
 * the outbox alone. This is what a session revoked server-side gets: the reads come
 * back from the server on the next sign-in, an unsynced point comes back from nowhere.
 */
export async function clearCachedReads(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await removePersistedQueryCache();
}

/**
 * Deletes everything this device holds for a coach, queued points and the marker
 * naming the player last viewed included, and forgets whose it was. Sign-out and a
 * coach switch call this and nothing else: it throws unsynced points away.
 */
export async function purgeLocalData(queryClient: QueryClient): Promise<void> {
  await clearCachedReads(queryClient);
  await deleteOutboxDatabase();
  clearLastViewedPlayerId();
  localStorage.removeItem(OWNER_KEY);
}

/**
 * Purges unless the device's data already belongs to this coach, then records them as
 * its owner. Anything but a recorded match purges, an absent record included: a device
 * that cannot say whose data it holds is not one to hand the next coach unwiped.
 */
export async function purgeIfCoachChanged(
  coachId: string,
  queryClient: QueryClient,
): Promise<void> {
  if (localStorage.getItem(OWNER_KEY) !== coachId) await purgeLocalData(queryClient);
  localStorage.setItem(OWNER_KEY, coachId);
}

/**
 * Claims an unclaimed device for the coach whose session the route guard confirmed, so
 * a login older than the record does not read as a stranger's at its next sign-in.
 * Never overwrites one: the guard may be reading a coach it served from the cache.
 */
export function recordOwnerIfUnknown(coachId: string): void {
  if (localStorage.getItem(OWNER_KEY) === null) localStorage.setItem(OWNER_KEY, coachId);
}
