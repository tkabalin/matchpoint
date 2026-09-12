/**
 * Resuming a match already under way on this device.
 *
 * Two consumers fold the same log the same way: `live-match.tsx` rehydrating capture
 * state after a phone died, a tab closed, or the app updated mid-match (#119), and the
 * in-progress banner deriving a live score to show before the coach has even tapped
 * back in (#251). Both go through `foldLoggedMatch` so the fold itself is written once.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";

import * as log from "@/features/outbox/match-log";
import type { LoggedMatch } from "@/features/outbox/match-log";

import { ScoreCheckpoint } from "./checkpoint";
import { Match } from "./match";
import { Point } from "./point";
import { foldScore, scoreboardFor } from "./score";
import type { MatchEvent, Scoreboard } from "./score";

export interface RestoredCapture {
  match: Match;
  events: MatchEvent[];
  board: Scoreboard;
  nextSequence: number;
}

async function foldLoggedMatch(logged: LoggedMatch): Promise<RestoredCapture> {
  const rows = await log.readLog(logged.matchId);
  const match = Match.fromJSON(logged.payload);
  const events = rows.map((event) =>
    event.kind === "checkpoint"
      ? ScoreCheckpoint.fromJSON(event.payload)
      : Point.fromJSON(event.payload),
  );
  return { match, events, board: foldScore(match, events), nextSequence: logged.nextSequence };
}

/**
 * The one unfinished match for this player, folded and ready to resume capturing, or
 * null where capture left nothing behind. Throws on a logged row that won't parse (an
 * older build's payload, a half-written event) — the caller decides how to tell the
 * coach, since `live-match.tsx` and the banner need to say it differently.
 */
export async function restoreInProgress(
  coachId: string,
  trackedPlayerId: string,
): Promise<RestoredCapture | null> {
  const found = await log.findInProgressFor(coachId, trackedPlayerId);
  if (found === undefined) return null;
  return foldLoggedMatch(found);
}

export interface InProgressSummary {
  trackedPlayerId: string;
  /** "6-4, 3-2, 40-15" — sets then the live game, the join `result-screen.tsx`'s own
   *  `scoreLine` uses for a finished match, extended to an unfinished one's last cell
   *  being the live call rather than a set score. */
  scoreLine: string;
  updatedAt: number;
}

function scoreLineFor(match: Match, board: Scoreboard): string {
  const rows = scoreboardFor(match, board);
  return rows.trackedPlayer.map((cell, index) => `${cell}-${rows.opponent[index]}`).join(", ");
}

/**
 * The freshest unfinished match on this device, reactively — a `useSyncExternalStore`
 * bridge over `watchInProgress`'s `liveQuery`, the same pattern `lib/theme.ts` uses for
 * its own external store. Deliberately not TanStack Query: `query-persist.ts` has no
 * `shouldDehydrateQuery` filter, so every key is persisted, and a persisted mirror here
 * would resurrect a banner for a match the outbox had since finished.
 *
 * `coachId` is `getRecordedOwner()`'s own return, off `localStorage` rather than a
 * `/coaches/me` query — the same reason `new-match.tsx` reads it that way: the
 * `_authenticated` route guard renders through when that query is unreachable, so a
 * networked coach id would black out the banner for exactly the coach at the court
 * with no connection, the one it exists for.
 */
export function useInProgressSummary(coachId: string | null): InProgressSummary | null {
  const stateRef = useRef<InProgressSummary | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (coachId === null) {
        // No coach recorded on this device yet, or one just signed out of it
        // (purgeLocalData clears the owner key after the outbox, so this also
        // covers the sign-out moment) — nothing to subscribe to, and nothing of
        // a previous coach's should keep advertising itself.
        stateRef.current = null;
        onStoreChange();
        return () => {};
      }
      let cancelled = false;
      // Each liveQuery emission folds independently and asynchronously, so a slow
      // fold for an older emission can resolve after a faster later one. Only the
      // fold matching the latest emission is allowed to write the snapshot.
      let latest = 0;
      const subscription = log.watchInProgress(coachId).subscribe({
        next: (rows) => {
          const seq = ++latest;
          const top = rows[0];
          if (top === undefined) {
            stateRef.current = null;
            onStoreChange();
            return;
          }
          void foldLoggedMatch(top)
            .then(({ match, board }) => {
              if (cancelled || seq !== latest) return;
              stateRef.current = {
                trackedPlayerId: top.trackedPlayerId,
                scoreLine: scoreLineFor(match, board),
                updatedAt: top.updatedAt,
              };
              onStoreChange();
            })
            .catch(() => {
              // A row that won't fold is one the banner should simply not offer,
              // rather than crash the screen it decorates over.
              if (cancelled || seq !== latest) return;
              stateRef.current = null;
              onStoreChange();
            });
        },
        error: () => {
          if (cancelled) return;
          stateRef.current = null;
          onStoreChange();
        },
      });
      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    },
    [coachId],
  );

  const getSnapshot = useCallback(() => stateRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
