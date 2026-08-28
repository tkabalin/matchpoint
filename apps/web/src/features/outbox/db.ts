/**
 * The outbox's IndexedDB schema, and the match log's.
 *
 * Its own database, never shared with query-cache persistence: clearing or
 * evicting the cache must not be able to reach a point that hasn't synced yet.
 * Operations live in `outbox.ts` and `match-log.ts`; keeping the schema alone in
 * here gives a future version bump one place to happen.
 *
 * The two tables answer different questions and are deliberately not merged. The
 * outbox is a message queue: rows are immutable, first-write-wins by id, and a
 * drained row is deleted. The log is state — every event of every match still on
 * this device, so a tab that dies mid-match reopens at the same score, and so undo
 * has something durable to pop. `purgeLocalData` deletes the whole database, so the
 * log inherits the sign-out rules with no extra code.
 */

import Dexie, { type EntityTable } from "dexie";

/**
 * Which entity a row's payload holds. A string union rather than a stored enum
 * so a new kind (#174 may add sets) widens it with no version bump —
 * nothing is indexed on the member list.
 *
 * `matchOutcome` is its own kind, not a rewrite of `match`'s row: the outbox is
 * first-write-wins by id, so a match already queued (points played first) can
 * never have its `outcomeOverride` folded into that row after the fact. A
 * retirement/walkover/default queues this instead, under a derived id, and the
 * drain sends it as its own request. See live-match.tsx's `endMatch`.
 *
 * `checkpoint` and `eventDelete` are queued by capture but not yet drained: the API has
 * no score-checkpoint or delete endpoint yet (see docs/scratch/database-changes-needed.md), and the
 * drain selects rows by kind, so they sit pending rather than failing.
 */
export type OutboxEntityKind = "match" | "point" | "matchOutcome" | "checkpoint" | "eventDelete";

/**
 * Whether the drain has a request for a kind: one answer for both sides of it,
 * since `drain.ts` sends only these and `watchCounts` counts only these. A
 * record, so widening the union above is a compile error until it is classified.
 */
const DRAINABLE_KINDS: Record<OutboxEntityKind, boolean> = {
  match: true,
  point: true,
  matchOutcome: true,
  checkpoint: false,
  eventDelete: false,
};

export function isDrainableKind(kind: OutboxEntityKind): boolean {
  return DRAINABLE_KINDS[kind];
}

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

/**
 * Why the drain parked a row: the refusal's HTTP status (null when the payload
 * itself could not be turned into a request) and a message for the sync status
 * UI. On the row rather than in drain memory so it survives a reload.
 */
export interface OutboxFailure {
  status: number | null;
  message: string;
}

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
  /** Set by `markFailed`, cleared by `retryFailed`. Not indexed, so no version bump. */
  failure?: OutboxFailure;
}

/**
 * One event of one match, as the log stores it: the domain object's own `toJSON()`
 * under its own id, tagged so it can be read back as the right class.
 */
export interface LoggedEvent {
  id: string;
  matchId: string;
  coachId: string;
  sequence: number;
  kind: "point" | "checkpoint";
  payload: unknown;
}

/**
 * The match itself, plus the two facts the log can't derive from its events:
 * the next sequence to hand out (which never decreases, so an undone one is never
 * reissued after a reload) and whether the coach has finished the match.
 */
export interface LoggedMatch {
  matchId: string;
  coachId: string;
  trackedPlayerId: string;
  nextSequence: number;
  // Not indexed: IndexedDB has no boolean key type, so "unfinished" is filtered in
  // memory off the coach's own matches rather than indexed as 0/1.
  finished: boolean;
  updatedAt: number;
  payload: unknown;
}

const db = new Dexie("matchpoint-outbox") as Dexie & {
  entries: EntityTable<OutboxRow, "seq">;
  events: EntityTable<LoggedEvent, "id">;
  matches: EntityTable<LoggedMatch, "matchId">;
};

// `&id` is unique: an entity appended twice is the same queue row, not two.
// `[coachId+status]` serves both the pending read and the two counts.
db.version(1).stores({
  entries: "++seq, &id, matchId, [coachId+status]",
});

// `[matchId+sequence]` is how a match's own log is read back, in order.
db.version(2).stores({
  entries: "++seq, &id, matchId, [coachId+status]",
  events: "id, matchId, [matchId+sequence]",
  matches: "matchId, coachId, [coachId+trackedPlayerId]",
});

export const outboxDb = db;
