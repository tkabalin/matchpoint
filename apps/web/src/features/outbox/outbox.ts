/**
 * The local queue a tap handler appends to and the sync layer drains.
 *
 * In `features/outbox/` rather than `features/sync/` because capture may not
 * import sync (see .claude/rules/web-capture.md) and a tap handler has to be
 * able to call `append`; both slices import this one instead.
 *
 * `append` never rejects. A tap handler doesn't await it — the score updates
 * synchronously and the write goes out behind it — so a rejection would be an
 * unhandled one, and a full disk would be a silently lost point. Failures come
 * back as an `AppendResult` and go to `onAppendFailure` listeners.
 */

import { liveQuery, type Observable } from "dexie";

import { outboxDb, OUTBOX_PAYLOAD_VERSION, type OutboxEntry, type OutboxRow } from "./db";

export interface AppendFailure {
  /** `quota_exceeded` is the one a coach can act on: free space, or sync. */
  reason: "quota_exceeded" | "write_failed";
  cause: unknown;
  /** The entry that didn't land, so a listener can name what was lost. */
  entry: OutboxEntry;
}

export type AppendResult = { ok: true; seq: number } | ({ ok: false } & AppendFailure);

export interface OutboxCounts {
  pending: number;
  failed: number;
}

type AppendFailureListener = (failure: AppendFailure) => void;

const appendFailureListeners = new Set<AppendFailureListener>();

/**
 * Subscribe to append failures; returns an unsubscribe function.
 *
 * This exists because the `AppendResult` has no reader when a tap fires
 * `append` without awaiting it. It is the only channel through which a lost
 * point reaches the UI, the counts being counts of rows that did get written.
 */
export function onAppendFailure(listener: AppendFailureListener): () => void {
  appendFailureListeners.add(listener);
  return () => {
    appendFailureListeners.delete(listener);
  };
}

/**
 * Appends an entity to the queue as `pending`, returning its enqueue order.
 *
 * First write wins: appending an id already queued returns where that row
 * already sits and leaves it untouched, `failed` ones included. A queued
 * payload is never rewritten because the drain acknowledges by id, so
 * rewriting one between its send and its ack would have `remove` delete a
 * payload the server never saw. `retryFailed` is the way back from `failed`.
 */
export async function append(entry: OutboxEntry): Promise<AppendResult> {
  requestPersistentStorage();
  try {
    // Everything awaited in here is a Dexie operation on this transaction. Await
    // anything else and IndexedDB commits early, so the write below fails with
    // TransactionInactiveError and the read above stops being atomic with it.
    const seq = await outboxDb.transaction("rw", outboxDb.entries, async () => {
      const existing = await outboxDb.entries.where("id").equals(entry.id).first();
      if (existing) return existing.seq;
      return await outboxDb.entries.add({
        ...entry,
        status: "pending",
        schemaVersion: OUTBOX_PAYLOAD_VERSION,
      });
    });
    return { ok: true, seq };
  } catch (cause) {
    const failure: AppendFailure = {
      reason: isQuotaExceeded(cause) ? "quota_exceeded" : "write_failed",
      cause,
      entry,
    };
    notifyAppendFailure(failure);
    return { ok: false, ...failure };
  }
}

function notifyAppendFailure(failure: AppendFailure): void {
  for (const listener of appendFailureListeners) {
    try {
      listener(failure);
    } catch {
      // One listener's bug must not reject `append` or cost the next listener
      // its notification: the tap that called this never awaited it, so the
      // rejection would surface nowhere and the lost point with it.
    }
  }
}

/**
 * Every row this coach still has to sync, oldest first. Failed rows are left
 * out on purpose: a drain walks this list in order, so including a row the
 * server has already rejected would stall everything behind it.
 */
export function readPending(coachId: string): Promise<OutboxRow[]> {
  return outboxDb.entries.where("[coachId+status]").equals([coachId, "pending"]).sortBy("seq");
}

/**
 * Every row for one match in enqueue order, failed ones included. This is how a
 * match interrupted by a crash or a closed tab is recovered: replaying these
 * payloads through the scoring reducer rebuilds the score, so no separate
 * snapshot format is needed.
 */
export function readByMatch(matchId: string): Promise<OutboxRow[]> {
  return outboxDb.entries.where("matchId").equals(matchId).sortBy("seq");
}

/** Drops rows the server has durably acknowledged. */
export async function remove(ids: readonly string[]): Promise<void> {
  await outboxDb.entries.where("id").anyOf(ids).delete();
}

/**
 * Parks rows the server rejected. Takes a list because a rejected match parks
 * its dependent points with it, which is one call, not one per point. Parking a
 * match does not fence off points appended for it afterwards, which arrive
 * pending, so a drain has to check a match's own status before sending them.
 */
export async function markFailed(ids: readonly string[]): Promise<void> {
  await outboxDb.entries.where("id").anyOf(ids).modify({ status: "failed" });
}

/** Returns every failed row of this coach's to the queue; answers how many. */
export function retryFailed(coachId: string): Promise<number> {
  return outboxDb.entries
    .where("[coachId+status]")
    .equals([coachId, "failed"])
    .modify({ status: "pending" });
}

/**
 * Pending and failed counts for the sync indicator, re-emitted whenever the
 * queue changes, so nothing polls. Both counts run in one read transaction, so
 * the pair is a consistent snapshot here rather than by grace of `liveQuery`
 * re-querying when a write lands between two untransacted reads.
 */
export function watchCounts(coachId: string): Observable<OutboxCounts> {
  return liveQuery(() =>
    outboxDb.transaction("r", outboxDb.entries, async () => ({
      pending: await countByStatus(coachId, "pending"),
      failed: await countByStatus(coachId, "failed"),
    })),
  );
}

function countByStatus(coachId: string, status: OutboxRow["status"]): Promise<number> {
  return outboxDb.entries.where("[coachId+status]").equals([coachId, status]).count();
}

let persistenceRequested = false;

/**
 * Asks the browser once, on the first append, to exempt this origin from
 * storage eviction. Neither awaited nor allowed to fail the append: a point must
 * not wait on this, and an unpersisted write is still a written point. Guarded
 * rather than left to the caller's `try` so a refusal can't be misread as a lost
 * write, and because `append` promises never to reject.
 */
function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // A storage manager that throws where the spec says it returns a promise.
  }
}

/**
 * Whether a write failed for want of space, which is the one failure a coach can
 * act on. Walks `inner` rather than reading one name: Dexie rethrows the
 * browser's DOMException wrapped in an error class of its own, and a write that
 * aborts a transaction gets wrapped again, so the name can be several levels
 * down. Bounded because nothing guarantees the chain doesn't loop.
 */
function isQuotaExceeded(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 10 && typeof candidate === "object" && candidate !== null; depth++) {
    const wrapper = candidate as { name?: unknown; inner?: unknown };
    if (wrapper.name === "QuotaExceededError") return true;
    candidate = wrapper.inner;
  }
  return false;
}
