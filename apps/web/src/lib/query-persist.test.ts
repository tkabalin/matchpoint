import { QueryClient, dehydrate, onlineManager } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { afterEach, expect, test, vi } from "vitest";

import { queryPersistOptions, removePersistedQueryCache } from "./query-persist";

/** The name db.ts on the outbox branch opens. Nothing here may ever write to it. */
const OUTBOX_DATABASE_NAME = "matchpoint-outbox";

function snapshot(): PersistedClient {
  const client = new QueryClient();
  client.setQueryData(["players"], [{ id: "p1", full_name: "Alex Court" }]);
  return {
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: dehydrate(client),
  };
}

afterEach(async () => {
  onlineManager.setOnline(true);
  await removePersistedQueryCache();
});

test("round-trips a snapshot through a database of the read cache's own", async () => {
  const persisted = snapshot();

  await queryPersistOptions.persister.persistClient(persisted);

  expect(await queryPersistOptions.persister.restoreClient()).toStrictEqual(persisted);

  const names = (await indexedDB.databases()).map((database) => database.name);
  expect(names).toContain("matchpoint-query-cache");
  // The hard constraint of #116: cached reads and unsynced points share no storage,
  // so evicting or clearing one can never reach the other.
  expect(names).not.toContain(OUTBOX_DATABASE_NAME);
});

test("drops the snapshot outright when sign-out clears the cache", async () => {
  await queryPersistOptions.persister.persistClient(snapshot());

  await removePersistedQueryCache();

  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();
});

test("busts on a real app version, not the library's empty default", () => {
  // Vite's `define` is what supplies this; if that wiring broke, the buster would be
  // the empty string and every release would silently reuse the previous one's cache.
  expect(queryPersistOptions.buster).toMatch(/^\d+\.\d+\.\d+/);
  // Left unset, the library expires a snapshot after a day rather than a week.
  expect(queryPersistOptions.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
});

test("keeps a paused write out of the read cache's snapshot", async () => {
  onlineManager.setOnline(false);
  const client = new QueryClient();
  void client
    .getMutationCache()
    .build(client, { mutationKey: ["add-player"], mutationFn: () => Promise.resolve(null) })
    .execute(null);
  await vi.waitFor(() => {
    expect(client.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
  });

  const dehydrated = dehydrate(client, queryPersistOptions.dehydrateOptions);

  // Query dehydrates paused mutations by default, which would put an offline write in
  // a database sign-out deletes and nothing ever resumes from. The outbox owns writes.
  expect(dehydrated.mutations).toStrictEqual([]);
});
