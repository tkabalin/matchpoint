/**
 * The sync status indicator on the live capture screen (#115): how many points are
 * still waiting to sync, how many the server has permanently refused, and a calm
 * reassurance rather than an alarm while offline. Quiet once everything has synced —
 * no element at all, the same "nothing to show" answer `InProgressBanner` gives.
 *
 * Tapping the failed count retries on the spot. The refusal reasons stay on the rows
 * (`OutboxRow.failure`) but are not shown: a coach mid-match can't act on them, so
 * the one thing the tap offers is another attempt.
 *
 * Lives outside `features/capture/` because retrying has to run the drain
 * (`features/sync/drain.ts`), and capture may not import `sync` (see
 * `.claude/rules/web-capture.md`). `coachId` is a plain prop for the same reason
 * `LiveMatch` receives one: the API client may not be imported from that slice.
 */

import { CloudAlert, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { retryFailed, watchCounts } from "@/features/outbox/outbox";
import type { OutboxCounts } from "@/features/outbox/outbox";
import { drainOutbox } from "@/features/sync/drain";
import { getDeviceId } from "@/lib/device-id";

const ZERO_COUNTS: OutboxCounts = { pending: 0, failed: 0 };

/** A `useSyncExternalStore` bridge over `watchCounts`, the same shape as
 * `useInProgressSummary` in `features/capture/resume.ts`. */
function useOutboxCounts(coachId: string): OutboxCounts {
  const stateRef = useRef<OutboxCounts>(ZERO_COUNTS);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const subscription = watchCounts(coachId).subscribe({
        next: (counts) => {
          stateRef.current = counts;
          onStoreChange();
        },
        error: () => {
          stateRef.current = ZERO_COUNTS;
          onStoreChange();
        },
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    [coachId],
  );

  const getSnapshot = useCallback(() => stateRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useOnlineStatus(): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener("online", onStoreChange);
    window.addEventListener("offline", onStoreChange);
    return () => {
      window.removeEventListener("online", onStoreChange);
      window.removeEventListener("offline", onStoreChange);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function SyncStatus({ coachId }: { coachId: string }) {
  const { pending, failed } = useOutboxCounts(coachId);
  const online = useOnlineStatus();
  // The count as it stood when the coach tapped, held for the length of the retry:
  // `retryFailed` moves the rows back to pending, so the live `failed` drops to zero
  // before the drain has said whether they landed, and the badge would flip to
  // "syncing" mid-attempt instead of spinning where the coach tapped.
  const [retrying, setRetrying] = useState<number | null>(null);

  async function retry() {
    setRetrying(failed);
    try {
      await retryFailed(coachId);
      await drainOutbox(coachId, getDeviceId());
    } catch {
      // A storage failure the drain could not classify, the same one
      // `features/sync/flush-triggers.ts` swallows: there is nothing this badge
      // could say about it, and the rows stay queued for the next sweep.
    } finally {
      setRetrying(null);
    }
  }

  // Rendered at the right of a screen's heading row, beside a title that never shrinks,
  // so on a narrow phone this is what wraps: `min-w-0` lets it shrink at all, and the
  // badge drops its fixed height and nowrap for the same reason.
  if (retrying !== null || failed > 0) {
    const count = retrying ?? failed;
    return (
      <button
        type="button"
        onClick={() => {
          void retry();
        }}
        disabled={retrying !== null}
        aria-busy={retrying !== null}
        className="min-w-0 text-right"
      >
        <Badge variant="destructive" className="h-auto min-h-5 whitespace-normal">
          {retrying !== null ? (
            <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <CloudAlert className="size-3 shrink-0" aria-hidden="true" />
          )}
          {count === 1 ? "1 point failed to sync" : `${String(count)} points failed to sync`}
        </Badge>
      </button>
    );
  }

  if (!online) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-right text-xs text-muted-foreground">
        <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
        {pending > 0
          ? `Offline — ${String(pending)} ${pending === 1 ? "point" : "points"} will sync when reconnected`
          : "Offline — recording continues, will sync when reconnected"}
      </div>
    );
  }

  if (pending > 0) {
    return (
      <Badge variant="secondary" className="min-w-0">
        <RefreshCw className="size-3" aria-hidden="true" />
        {pending === 1 ? "1 syncing" : `${String(pending)} syncing`}
      </Badge>
    );
  }

  return null;
}
