/**
 * The outbox's IndexedDB schema.
 *
 * Its own database, never shared with query-cache persistence: clearing or
 * evicting the cache must not be able to reach a point that hasn't synced yet.
 * Operations live in `outbox.ts`; keeping the schema alone in here gives a
 * future version bump one place to happen.
 */

import Dexie, { type EntityTable } from "dexie";

/**
 * Which entity a row's payload holds. A string union rather than a stored enum
 * so a new kind (#174 may add sets) widens it with no version bump —
 * nothing is indexed on the member list.
 */
export type OutboxEntityKind = "match" | "point";

/**
 * `failed` is where the drain engine parks a row the server rejected, so it
 * stops being retried without being thrown away. `readPending` skips those,
 * which is what keeps one rejected row from blocking every row behind it.
 */
export type OutboxStatus = "pending" | "failed";

/**
 * Stamped on every row so a drain can tell which app version wrote a payload.
 * Bump it when a `toJSON()` shape changes in a way the matching `fromJSON`
 * can't read: an app update can land between the append and the drain, so
 * rows written by the previous version are always in the queue.
 */
export const OUTBOX_PAYLOAD_VERSION = 1;

/** What a caller hands to `append`. Becomes an `OutboxRow` once stored. */
export interface OutboxEntry {
  /** The entity's own client-generated UUID (`Point.id`, `Match.matchId`). */
  id: string;
  coachId: string;
  matchId: string;
  kind: OutboxEntityKind;
  /**
   * The entity's `toJSON()` output, opaque here and structurally checked by
   * `fromJSON` on the way out. Opaque is the point: this layer needs no
   * knowledge of the capture field list, so neither waits on the other. Must
   * be structured-cloneable, which plain `toJSON()` output always is.
   */
  payload: unknown;
}

export interface OutboxRow extends OutboxEntry {
  /**
   * Enqueue order, and the primary key, from IndexedDB's own key generator.
   * Deleting rows never winds it back, so order survives a drain clearing the
   * rows in front of those still queued. An aborted transaction does wind it
   * back, but only to a number no committed row holds: overlapping writes are
   * serialised, so a reused number can't land below an existing row.
   */
  seq: number;
  status: OutboxStatus;
  schemaVersion: number;
}

const db = new Dexie("matchpoint-outbox") as Dexie & {
  entries: EntityTable<OutboxRow, "seq">;
};

// `&id` is unique: an entity appended twice is the same queue row, not two.
// `[coachId+status]` serves both the pending read and the two counts.
db.version(1).stores({
  entries: "++seq, &id, matchId, [coachId+status]",
});

export const outboxDb = db;
