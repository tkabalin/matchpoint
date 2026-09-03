import { expect, type Page } from "@playwright/test";

import { Match } from "@/features/capture/match";
import { Point } from "@/features/capture/point";

// The database and store src/features/outbox/db.ts declares. Most offline specs
// fill it through capture-screen taps; the ones that need hundreds of rows, or a
// state taps cannot set up, write rows into it directly (see offline.spec.ts),
// so the shape here has to match what the drain reads back. A drifted row fails
// loudly in-spec when Match.fromJSON or Point.fromJSON refuses the payload.
const OUTBOX_DB = "matchpoint-outbox";
const OUTBOX_STORE = "entries";

// OUTBOX_PAYLOAD_VERSION in db.ts. A literal rather than an import: importing
// db.ts would construct its Dexie instance in Node, where no IndexedDB exists.
const PAYLOAD_VERSION = 1;

/** An outbox row as stored, minus `seq`, which IndexedDB's key generator assigns. */
export interface SeedRow {
  id: string;
  coachId: string;
  matchId: string;
  kind: "match" | "point";
  payload: unknown;
  status: "pending" | "failed";
  schemaVersion: number;
}

/**
 * A pending match-create row, its payload built by the real capture model so the
 * seed can never drift from what the drain's `Match.fromJSON` accepts.
 */
export function buildMatchRow(fields: {
  coachId: string;
  playerId: string;
  opponentName: string;
}): SeedRow {
  const matchId = crypto.randomUUID();
  const match = Match.create({
    matchId,
    // Yesterday in UTC: never ahead of the server's "today", whatever the zone.
    playedOn: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    trackedPlayerId: fields.playerId,
    // A stand-in id, as createMatch mints for an unrostered opponent; the name
    // carries the identity the server stores.
    opponentId: crypto.randomUUID(),
    opponentName: fields.opponentName,
    scoringSystem: "traditional",
    firstServer: fields.playerId,
    surfaceType: "unspecified",
    outcomeOverride: null,
  });
  return {
    id: matchId,
    coachId: fields.coachId,
    matchId,
    kind: "match",
    payload: match.toJSON(),
    status: "pending",
    schemaVersion: PAYLOAD_VERSION,
  };
}

/**
 * A pending point row for a match already queued or already on the server: an ace
 * on the tracked player's serve, the one-tap point, built by the real capture
 * model for the reason buildMatchRow gives. The stamps place every point in the
 * first game, which the server stores as sent, never replaying the scoring.
 */
export function buildPointRow(fields: {
  coachId: string;
  matchId: string;
  sequence: number;
}): SeedRow {
  const point = Point.create({
    id: crypto.randomUUID(),
    matchId: fields.matchId,
    timestamp: Date.now(),
    sequence: fields.sequence,
    server: "TRACKED",
    courtSide: fields.sequence % 2 === 0 ? "DEUCE" : "AD",
    won: true,
    context: {
      setNumber: 1,
      gameNumber: 1,
      inTiebreak: false,
      isBreakPoint: false,
      isGamePoint: false,
      isGameEnd: false,
      isSetPoint: false,
      isSetEnd: false,
      isMatchPoint: false,
    },
    serves: [{ number: 1, outcome: "ACE", location: null }],
    returnOutcome: null,
    endReason: "ACE",
    unusualReason: null,
    unusualNote: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: null,
    ballLocation: null,
    rallyLengthBucket: null,
  });
  return {
    id: point.id,
    coachId: fields.coachId,
    matchId: fields.matchId,
    kind: "point",
    payload: point.toJSON(),
    status: "pending",
    schemaVersion: PAYLOAD_VERSION,
  };
}

/**
 * Writes rows into the outbox exactly as a capture tap's `append` would land
 * them, once the app's own Dexie instance has the store open (see the poll).
 * Written outside Dexie, though, so the drain's liveQuery nudge never fires for
 * these: a seeded row waits for a launch or for connectivity to return, which is
 * why every seeding spec brackets the seed in setOffline(true)/setOffline(false).
 */
export async function seedOutbox(page: Page, rows: readonly SeedRow[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ dbName, storeName }) => {
            // Listed first, and only then opened: an unversioned open of a database
            // that does not exist creates an empty one, which is the schema fight
            // this guard is here to avoid. Listed is not yet usable, though, so the
            // store has to be seen as well.
            if (!(await indexedDB.databases()).some((db) => db.name === dbName)) return false;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(dbName);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error as Error);
            });
            const ready = db.objectStoreNames.contains(storeName);
            db.close();
            return ready;
          },
          { dbName: OUTBOX_DB, storeName: OUTBOX_STORE },
        ),
      { message: `the app never created ${OUTBOX_DB}` },
    )
    .toBe(true);
  await page.evaluate(
    async ({ dbName, storeName, entries }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          for (const entry of entries) tx.objectStore(storeName).add(entry);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error as Error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: OUTBOX_DB, storeName: OUTBOX_STORE, entries: rows },
  );
}

/** Every outbox row, in enqueue order, as a spec's durability assertions read them. */
export function readOutboxRows(page: Page): Promise<(SeedRow & { seq: number })[]> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      if (!(await indexedDB.databases()).some((db) => db.name === dbName)) return [];
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });
      try {
        return await new Promise<(SeedRow & { seq: number })[]>((resolve, reject) => {
          const request = db.transaction(storeName).objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result as (SeedRow & { seq: number })[]);
          request.onerror = () => reject(request.error as Error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: OUTBOX_DB, storeName: OUTBOX_STORE },
  );
}

/** Deletes one row by entity id: what undoing a capture before it syncs does. */
export async function deleteOutboxRow(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async ({ dbName, storeName, entityId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const lookup = store.index("id").getKey(entityId);
          lookup.onsuccess = () => {
            if (lookup.result !== undefined) store.delete(lookup.result);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error as Error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: OUTBOX_DB, storeName: OUTBOX_STORE, entityId: id },
  );
}

/**
 * Resolves once the service worker is active and controlling the page, which is
 * when going offline stops being a blank tab: the precache is written during
 * install, and control is what routes the next navigation through it.
 */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // registerType "prompt" claims no existing clients, so the first worker a
  // fresh profile installs controls nothing until the next navigation; reload
  // once, while still online, to become its client.
  if (await page.evaluate(() => navigator.serviceWorker.controller === null)) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: "the service worker never took control of the page",
    })
    .toBe(true);
}
