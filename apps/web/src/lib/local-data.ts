/**
 * What this device keeps for whoever is signed in, coach or player, and the two
 * different ways it goes away.
 *
 * Both stores live here rather than at each call site because the difference between
 * them is the subtle part: cached reads can always be fetched again, so a revoked
 * session drops them, while the outbox holds points the server has never seen and
 * only an explicit sign-out or a switch to a different owner may delete it.
 */

import type { QueryClient } from "@tanstack/react-query";

import { countUnsynced, deleteOutboxDatabase } from "@/features/outbox/outbox";

import { clearLastViewedPlayerId } from "./last-viewed-player";
import { removePersistedQueryCache } from "./query-persist";

/**
 * Whose data on this device this is — a coach's or a player's id, either one. Deliberately
 * outlives a 401: it is what lets the next sign-in tell "the same owner, whose queued
 * points are still theirs" from "someone else, purge before anything of the previous
 * owner's renders".
 */
const OWNER_KEY = "matchpoint:local-data-owner";

export type OwnerKind = "coach" | "player";

/**
 * Which *kind* of principal `OWNER_KEY` names — a coach or a player — tracked
 * separately so `/`'s own guard can guess the right destination (`/home` or `/me`)
 * offline, before either `_authenticated.tsx` or `_player.tsx` has had a chance to
 * confirm anything over the network (#257/#203). Nothing else reads this: the sync
 * layer and the purge rules only ever cared about the id, which is why it isn't
 * folded into `OWNER_KEY` itself — that would change a format every existing reader
 * of `getRecordedOwner()` already assumes is a bare id.
 */
const OWNER_KIND_KEY = "matchpoint:local-data-owner-kind";

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
 * Points and other queued rows the outbox still holds for whoever's signed in, combined
 * into one number: purgeLocalData doesn't distinguish pending from parked when it deletes
 * them, so the sign-out warning shouldn't either. No recorded owner reads as nothing to
 * lose.
 */
export async function countUnsyncedRows(): Promise<number> {
  const ownerId = getRecordedOwner();
  if (ownerId === null) return 0;
  const { pending, failed } = await countUnsynced(ownerId);
  return pending + failed;
}

/**
 * Deletes everything this device holds for whoever is signed in, queued points and the
 * marker naming the player last viewed included, and forgets whose it was. Sign-out and
 * a switch to a different owner call this and nothing else: it throws unsynced points
 * away.
 */
export async function purgeLocalData(queryClient: QueryClient): Promise<void> {
  await clearCachedReads(queryClient);
  await deleteOutboxDatabase();
  clearLastViewedPlayerId();
  localStorage.removeItem(OWNER_KEY);
  localStorage.removeItem(OWNER_KIND_KEY);
}

/**
 * Purges unless the device's data already belongs to this id, then records it as the
 * owner. Anything but a recorded match purges, an absent record included: a device
 * that cannot say whose data it holds is not one to hand the next owner unwiped. The id
 * is a coach's or a player's — the two sign-in flows share this one function, since the
 * purge rule doesn't care which kind of principal it is, only whether the id changed.
 */
export async function purgeIfOwnerChanged(
  ownerId: string,
  queryClient: QueryClient,
  kind: OwnerKind,
): Promise<void> {
  if (localStorage.getItem(OWNER_KEY) !== ownerId) await purgeLocalData(queryClient);
  localStorage.setItem(OWNER_KEY, ownerId);
  localStorage.setItem(OWNER_KIND_KEY, kind);
}

/**
 * Claims an unclaimed device for the principal whose session a route guard just
 * confirmed, so a login older than the record does not read as a stranger's at its
 * next sign-in. Never overwrites one: the guard may be reading an owner it served from
 * the cache. Called from both `_authenticated.tsx` (a coach) and `_player.tsx` (a
 * player) — same reasoning as `purgeIfOwnerChanged` above.
 */
export function recordOwnerIfUnknown(ownerId: string, kind: OwnerKind): void {
  if (localStorage.getItem(OWNER_KEY) === null) {
    localStorage.setItem(OWNER_KEY, ownerId);
    localStorage.setItem(OWNER_KIND_KEY, kind);
  }
}

/**
 * Whose data this device holds, or null before any owner has been recorded. The sync
 * layer's triggers fire with no owner in hand (a window event, a timer), and everything
 * in the outbox is the owner's by the purge rules above, so this is the id a drain runs
 * for.
 */
export function getRecordedOwner(): string | null {
  return localStorage.getItem(OWNER_KEY);
}

/**
 * Which kind of principal `getRecordedOwner()` names, or null before any owner has
 * been recorded (or for a device claimed before this existed — see #257's `/` guard,
 * the one reader that needs to know, and which falls back to guessing when this is
 * absent).
 */
export function getRecordedOwnerKind(): OwnerKind | null {
  const kind = localStorage.getItem(OWNER_KIND_KEY);
  return kind === "coach" || kind === "player" ? kind : null;
}
