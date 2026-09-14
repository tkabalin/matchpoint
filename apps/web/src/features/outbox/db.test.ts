import Dexie, { type EntityTable } from "dexie";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { isDrainableKind, outboxDb, type OutboxEntityKind, type OutboxRow } from "./db";

const DATABASE_NAME = "matchpoint-outbox";

// A Record rather than an array: widening `OutboxEntityKind` is then a compile error
// here until the new kind is listed, the same guarantee `DRAINABLE_KINDS` gives the
// source. The value is unused — only the exhaustive key set is.
const EVERY_KIND: Record<OutboxEntityKind, true> = {
  match: true,
  point: true,
  matchOutcome: true,
  checkpoint: true,
  eventDelete: true,
};
const ALL_KINDS = Object.keys(EVERY_KIND) as OutboxEntityKind[];

interface ReflectedIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
}

interface ReflectedStore {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: ReflectedIndex[];
}

/**
 * What IndexedDB actually built, read back through the raw API rather than Dexie's
 * own `Table.schema`. Asserting on the declarations would only restate the schema
 * string; this proves the stores and indexes those strings claim really exist.
 */
async function reflectStores(): Promise<Record<string, ReflectedStore>> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("could not open the outbox database"));
    };
  });
  try {
    const transaction = connection.transaction([...connection.objectStoreNames], "readonly");
    const stores: Record<string, ReflectedStore> = {};
    for (const name of connection.objectStoreNames) {
      const store = transaction.objectStore(name);
      stores[name] = {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map((indexName) => {
          const index = store.index(indexName);
          return { name: indexName, keyPath: index.keyPath, unique: index.unique };
        }),
      };
    }
    return stores;
  } finally {
    connection.close();
  }
}

beforeEach(async () => {
  await outboxDb.delete();
  await outboxDb.open();
});

// The upgrade test closes and replaces the database, so the singleton every other
// test file imports is put back open before the run moves on.
afterEach(async () => {
  if (!outboxDb.isOpen()) await outboxDb.open();
});

describe("isDrainableKind", () => {
  test("every kind now has a request the drain can send", () => {
    expect(ALL_KINDS.filter(isDrainableKind)).toEqual([
      "match",
      "point",
      "matchOutcome",
      "checkpoint",
      "eventDelete",
    ]);
  });
});

describe("the schema", () => {
  test("builds the three tables the outbox and the match log need", async () => {
    expect(Object.keys(await reflectStores()).sort()).toEqual(["entries", "events", "matches"]);
  });

  test("keys the queue on enqueue order, with one row per entity id", async () => {
    const entries = (await reflectStores()).entries!;

    expect(entries.keyPath).toBe("seq");
    // The key generator is what makes `seq` an order rather than an identifier, and
    // the unique `id` is what makes appending the same entity twice one row, not two.
    expect(entries.autoIncrement).toBe(true);
    expect(entries.indexes).toEqual([
      { name: "[coachId+status]", keyPath: ["coachId", "status"], unique: false },
      { name: "id", keyPath: "id", unique: true },
      { name: "matchId", keyPath: "matchId", unique: false },
    ]);
  });

  test("indexes a match's own log by the sequence it is read back in", async () => {
    const stores = await reflectStores();

    expect(stores.events!.keyPath).toBe("id");
    expect(stores.events!.indexes).toEqual([
      { name: "[matchId+sequence]", keyPath: ["matchId", "sequence"], unique: false },
      { name: "matchId", keyPath: "matchId", unique: false },
    ]);
    expect(stores.matches!.keyPath).toBe("matchId");
    expect(stores.matches!.indexes).toEqual([
      { name: "[coachId+trackedPlayerId]", keyPath: ["coachId", "trackedPlayerId"], unique: false },
      { name: "coachId", keyPath: "coachId", unique: false },
    ]);
  });
});

describe("upgrading a database written by an older app version", () => {
  test("keeps the rows already queued and adds the log's two tables", async () => {
    await outboxDb.close();
    await Dexie.delete(DATABASE_NAME);

    // Version 1 as it actually shipped: the queue alone, before the match log existed.
    const shipped = new Dexie(DATABASE_NAME) as Dexie & {
      entries: EntityTable<OutboxRow, "seq">;
    };
    shipped.version(1).stores({ entries: "++seq, &id, matchId, [coachId+status]" });
    await shipped.entries.add({
      id: "3f1c2b4e-0000-4000-8000-000000000001",
      coachId: "c0ac0000-0000-4000-8000-000000000001",
      matchId: "3f1c2b4e-0000-4000-8000-000000000002",
      kind: "point",
      payload: { gameId: "g1" },
      status: "pending",
      schemaVersion: 1,
    });
    shipped.close();

    await outboxDb.open();

    // An app update lands between an append and a drain, so a point captured on the
    // old version has to still be there to send afterwards.
    const queued = await outboxDb.entries.toArray();
    expect(queued.map((row) => row.id)).toEqual(["3f1c2b4e-0000-4000-8000-000000000001"]);
    expect(Object.keys(await reflectStores()).sort()).toEqual(["entries", "events", "matches"]);
  });
});
