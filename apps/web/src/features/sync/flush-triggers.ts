/**
 * When the drain runs. iOS PWAs have no Background Sync API, so nothing
 * flushes unless the foregrounded app is told to: at launch, when connectivity
 * returns, when the app becomes visible again, and when a queue write lands
 * while already online. Every trigger funnels into one debounced schedule so a
 * burst coalesces into a single drain; overlap was already harmless (the
 * drain's web lock), the debounce makes it cheap.
 */

import { liveQuery } from "dexie";

import { outboxDb } from "@/features/outbox/db";
import { append, onAppendFailure, type AppendFailure } from "@/features/outbox/outbox";
import { getDeviceId } from "@/lib/device-id";
import { getRecordedOwner } from "@/lib/local-data";

import { drainOutbox, isDatabaseClosed } from "./drain";

export const DRAIN_DEBOUNCE_MS = 1_000;

/** Spaced so the reopened connection gets real chances before the entry is lost. */
export const APPEND_RETRY_DELAYS_MS = [200, 1_000, 5_000];

/**
 * Wires every flush opportunity up and fires the launch one; returns the
 * unregister. The coach is resolved per drain, not at registration: a sign-in
 * can land later in this app's life, and rows only ever belong to the recorded
 * owner of the device's data.
 */
export function registerFlushTriggers(): () => void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const scheduleDrain = () => {
    if (stopped) return;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      const coachId = getRecordedOwner();
      if (coachId === null) return;
      void drainOutbox(coachId, getDeviceId()).then(
        // A run that found the lock held did none of this trigger's work, and
        // the holder's own removals are the only thing that would re-emit the
        // nudge, so re-arm rather than wait for whatever fires next.
        (result) => {
          if (result.skipped) scheduleDrain();
        },
        () => {
          // A drain rejects only on a storage failure it could not classify,
          // and a trigger has no reader to hand it to, so an unhandled
          // rejection is all it could become. The next trigger sweeps again.
        },
      );
    }, DRAIN_DEBOUNCE_MS);
  };

  const onOnline = () => {
    scheduleDrain();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") scheduleDrain();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // The append nudge, without widening the outbox contract: any change to the
  // queue re-emits this count. The drain's own removals re-emit too; those
  // extra drains find nothing pending and write nothing, so the loop settles.
  // Gated on navigator.onLine because this one fires mid-capture, every point:
  // offline it would only burn the backoff schedule, and the online event
  // above already covers connectivity returning.
  const nudge = liveQuery(() => outboxDb.entries.count()).subscribe({
    next: (count) => {
      if (count > 0 && navigator.onLine) scheduleDrain();
    },
    error: () => {
      // A dead observable must not take the other triggers with it; they
      // remain enough to drain on. liveQuery does not resubscribe itself.
    },
  });

  const unsubscribeRetry = onAppendFailure(retryLostAppend);

  // App launch is a trigger like any other: whatever survived the last visit
  // goes out as soon as the debounce window closes.
  scheduleDrain();

  return () => {
    stopped = true;
    if (debounce !== null) clearTimeout(debounce);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    nudge.unsubscribe();
    unsubscribeRetry();
  };
}

/** Entries mid-retry, so our own retry's failure cannot spawn a second chain. */
const retrying = new Set<string>();

/**
 * Re-appends an entry lost to Dexie's DatabaseClosedError: another tab
 * upgrading the outbox schema aborts this tab's in-flight append, the tap that
 * fired it never awaited it, and the storage layer deliberately does not
 * decide what is worth retrying. The close is self-healing (the connection
 * reopens on the next operation), so a few spaced attempts recover the point.
 * Exported for its tests; registerFlushTriggers subscribes it.
 */
export function retryLostAppend(failure: AppendFailure): void {
  if (!isDatabaseClosed(failure.cause) || retrying.has(failure.entry.id)) return;
  retrying.add(failure.entry.id);
  void (async () => {
    try {
      for (const delay of APPEND_RETRY_DELAYS_MS) {
        await sleep(delay);
        const result = await append(failure.entry);
        if (result.ok || !isDatabaseClosed(result.cause)) return;
      }
    } finally {
      retrying.delete(failure.entry.id);
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
