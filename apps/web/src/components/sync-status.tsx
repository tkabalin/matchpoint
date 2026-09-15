/**
 * The sync status indicator on the live capture screen (#115): how many points are
 * still waiting to sync, which ones the server has permanently refused (with why, not
 * just a count), and a calm reassurance rather than an alarm while offline. Quiet once
 * everything has synced — no element at all, the same "nothing to show" answer
 * `InProgressBanner` gives.
 *
 * Lives outside `features/capture/` because retrying has to run the drain
 * (`features/sync/drain.ts`), and capture may not import `sync` (see
 * `.claude/rules/web-capture.md`). `coachId` is a plain prop for the same reason
 * `LiveMatch` receives one: the API client may not be imported from that slice.
 */

import { CloudAlert, RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OutboxRow } from "@/features/outbox/db";
import { retryFailed, watchCounts, watchFailed } from "@/features/outbox/outbox";
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

/**
 * One line per distinct rejection reason rather than one per row: a parked match
 * parks its dependent points alongside it with the same message (see `drain.ts`'s
 * `park`), so grouping is what keeps ten identical refusals from reading as a wall
 * of repeats.
 */
function groupByReason(rows: readonly OutboxRow[]): { message: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const message = row.failure?.message ?? "The server refused this.";
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }
  return [...counts.entries()].map(([message, count]) => ({ message, count }));
}

function FailedDetailSheet({
  coachId,
  open,
  onOpenChange,
}: {
  coachId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Live rather than a one-shot read on open: a retry that re-parks a row should
    // update this list on its own, with nothing here re-fetching by hand.
    const subscription = watchFailed(coachId).subscribe((next) => {
      setRows(next);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [coachId, open]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryFailed(coachId);
      await drainOutbox(coachId, getDeviceId());
    } finally {
      setRetrying(false);
    }
  }

  const reasons = groupByReason(rows);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Couldn&apos;t sync</SheetTitle>
          <SheetDescription>
            The server refused these. Retrying sends them again as they are.
          </SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-2 text-sm">
          {reasons.map((reason) => (
            <li key={reason.message} className="flex items-start gap-2">
              <span className="font-semibold tabular-nums">{reason.count}</span>
              <span className="text-muted-foreground">{reason.message}</span>
            </li>
          ))}
        </ul>
        <SheetFooter className="p-0">
          <Button
            onClick={() => {
              void handleRetry();
            }}
            disabled={retrying || rows.length === 0}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function SyncStatus({ coachId }: { coachId: string }) {
  const { pending, failed } = useOutboxCounts(coachId);
  const online = useOnlineStatus();
  const [detailOpen, setDetailOpen] = useState(false);

  // Rendered at the right of a screen's heading row, beside a title that never shrinks,
  // so on a narrow phone this is what wraps: `min-w-0` lets it shrink at all, and the
  // badge drops its fixed height and nowrap for the same reason.
  if (failed > 0) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setDetailOpen(true);
          }}
          className="min-w-0 text-right"
        >
          <Badge variant="destructive" className="h-auto min-h-5 whitespace-normal">
            <CloudAlert className="size-3 shrink-0" aria-hidden="true" />
            {failed === 1 ? "1 point failed to sync" : `${String(failed)} points failed to sync`}
          </Badge>
        </button>
        <FailedDetailSheet coachId={coachId} open={detailOpen} onOpenChange={setDetailOpen} />
      </>
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
