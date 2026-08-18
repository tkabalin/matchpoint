/**
 * Persistence for TanStack Query's read cache, so match setup at the court finds
 * the roster and match lists already there with no connection.
 *
 * Its own IndexedDB database, never the outbox's: evicting or clearing cached
 * reads must not be able to reach a point that has not synced yet.
 */

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";

// Defined by Vite from apps/web/package.json; see the `define` block in vite.config.ts.
declare const __APP_VERSION__: string;

/**
 * How old a restored snapshot may be, and equally the QueryClient's `gcTime` in
 * main.tsx: a query dropped from memory sooner than this is missing from the next
 * save, so a shorter gcTime would quietly shrink what survives a restart.
 */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Named rather than idb-keyval's default "keyval-store", which is a name any other
// caller of the library would land in too.
const cacheStore = createStore("matchpoint-query-cache", "cache");

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key, cacheStore),
    setItem: (key, value) => set(key, value, cacheStore),
    removeItem: (key) => del(key, cacheStore),
  },
});

/**
 * `buster` is the app version, so bumping it on a release that changes what a cached
 * response looks like discards every snapshot an older one wrote, rather than
 * hydrating a shape the new code cannot read.
 */
export const queryPersistOptions = {
  persister,
  maxAge: QUERY_CACHE_MAX_AGE_MS,
  buster: __APP_VERSION__,
  // Query would otherwise dehydrate paused mutations into this snapshot as well, and
  // an offline write belongs in the outbox, which owns resuming it. Keeping them out
  // is what makes this database reads-only, and safe to clear at any time.
  dehydrateOptions: { shouldDehydrateMutation: () => false },
} satisfies Omit<PersistQueryClientOptions, "queryClient">;

/**
 * Deletes the persisted snapshot. Sign-out and a dead session call this: clearing the
 * in-memory cache leaves the coach's roster on the device otherwise.
 */
export async function removePersistedQueryCache(): Promise<void> {
  await persister.removeClient();
}
