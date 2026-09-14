/**
 * The capture screen's side of the single-writer claim (#197). `features/capture/`
 * may not import the API client at all (see .claude/rules/web-capture.md), so this
 * lives here beside `new-match.tsx`, the bridge that already fetches what capture
 * itself can't.
 *
 * The claim is advisory: a device capturing offline can't take or renew one, and
 * offline capture is the app's premise. So the rule throughout is claim when you
 * can, never block capture on it — every failure to claim is silent, not an error.
 */

import { claimCapture, getMatch, releaseCapture } from "@matchpoint/api-client";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { getDeviceId } from "@/lib/device-id";
import { parseErrorMessage } from "@/lib/parse-error";
import { watchInProgressFor } from "@/features/outbox/match-log";
import { hasQueuedCreate, watchQueuedCreate } from "@/features/outbox/outbox";

export type ClaimOutcome =
  | { kind: "claimed" }
  /** 409, and the match's own result is still null: another device holds it. */
  | { kind: "conflict" }
  /** 409, and the match's own result is already recorded. */
  | { kind: "finished" }
  /** 404 — deleted from another device (#214), on the claim itself or the
   *  follow-up read that disambiguates a 409. */
  | { kind: "gone" }
  /** Offline, the create hasn't synced yet, or a network/401/422/429 response —
   *  fail open, capture starts (or keeps going) with no claim and no error. */
  | { kind: "unavailable" };

/**
 * Attempts to claim `matchId` for this device. Never throws: every branch the
 * caller can't act on collapses to "unavailable" rather than surfacing an error,
 * per the claim's own advisory-only design.
 */
export async function attemptClaim(matchId: string, deviceId: string): Promise<ClaimOutcome> {
  if (!navigator.onLine) return { kind: "unavailable" };
  // The server doesn't know this match exists until its create row drains — a claim
  // sent ahead of that would race the create itself and could read back a spurious
  // 404, indistinguishable from one actually deleted elsewhere.
  if (await hasQueuedCreate(matchId)) return { kind: "unavailable" };

  const { error, response } = await claimCapture({
    path: { match_id: matchId },
    body: { device_id: deviceId },
  });
  if (!error) return { kind: "claimed" };
  // `response` is undefined for a network failure the client caught internally
  // (fetch itself threw, no response ever arrived) — that's "unavailable" too.
  if (response?.status === 404) return { kind: "gone" };
  if (response?.status !== 409) return { kind: "unavailable" };

  // Both 409 causes share one response shape (docs/offline-sync.md § Capture claim) —
  // the match's own `result` is the only thing that tells them apart.
  const { data: match, response: matchResponse } = await getMatch({ path: { match_id: matchId } });
  if (matchResponse?.status === 404) return { kind: "gone" };
  // An inconclusive follow-up (a network hiccup, 401/422/429) defaults to
  // "conflict": an unwarranted takeover prompt is recoverable, wrongly declaring
  // the match finished or gone isn't.
  if (match === undefined) return { kind: "conflict" };
  return match.result !== null ? { kind: "finished" } : { kind: "conflict" };
}

export interface CaptureClaim {
  matchId: string | null;
  /** Another device holds the claim — offer the takeover prompt. */
  conflict: boolean;
  /** The match's result was already recorded elsewhere. */
  finishedElsewhere: boolean;
  /** The match was deleted from another device. */
  gone: boolean;
  takingOver: boolean;
  takeoverError: string | null;
  takeOver: () => void;
  declineTakeover: () => void;
}

/**
 * Claims the coach's in-progress match for this device, reactively. Re-attempts on
 * three triggers — the match becoming known, its create clearing the outbox, and
 * the browser coming back online — which is the renewal: the four-hour lease
 * outlasts any plausible match, so no separate timer exists (see #197's own
 * reasoning). `matchId` comes from the log rather than a prop, since `LiveMatch`
 * exposes none out.
 */
export function useCaptureClaim({
  coachId,
  trackedPlayerId,
}: {
  coachId: string;
  trackedPlayerId: string;
}): CaptureClaim {
  const [matchId, setMatchId] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [finishedElsewhere, setFinishedElsewhere] = useState(false);
  const [gone, setGone] = useState(false);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);

  // Read by the retry effect below so a terminal outcome stops retrying against a
  // match that's already finished or gone, without pulling either into that
  // effect's own dependency list.
  const terminalRef = useRef(false);
  useEffect(() => {
    terminalRef.current = finishedElsewhere || gone;
  }, [finishedElsewhere, gone]);

  useEffect(() => {
    const subscription = watchInProgressFor(coachId, trackedPlayerId).subscribe((row) => {
      setMatchId(row?.matchId ?? null);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [coachId, trackedPlayerId]);

  useEffect(() => {
    if (matchId === null) return;
    let cancelled = false;
    let previousQueued: boolean | undefined;

    async function tryClaim() {
      if (terminalRef.current) return;
      const outcome = await attemptClaim(matchId!, getDeviceId());
      if (cancelled) return;
      if (outcome.kind === "claimed") setConflict(false);
      if (outcome.kind === "conflict") setConflict(true);
      if (outcome.kind === "finished") setFinishedElsewhere(true);
      if (outcome.kind === "gone") setGone(true);
    }

    // The queued-create watch's first emission is the initial attempt; a later
    // flip from queued to cleared is the "just synced" retry that closes the
    // create/claim race described in `attemptClaim`'s own comment.
    const queuedSubscription = watchQueuedCreate(matchId).subscribe((queued) => {
      const wasQueued = previousQueued;
      previousQueued = queued;
      if (wasQueued === undefined || (wasQueued && !queued)) void tryClaim();
    });

    const onOnline = () => {
      void tryClaim();
    };
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      queuedSubscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [matchId]);

  const { mutate: takeOver, isPending: takingOver } = useMutation({
    mutationFn: async (): Promise<ClaimOutcome> => {
      if (matchId === null) return { kind: "unavailable" };
      const { error: releaseError } = await releaseCapture({ path: { match_id: matchId } });
      if (releaseError) throw releaseError;
      return attemptClaim(matchId, getDeviceId());
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "conflict") {
        setTakeoverError("Still being captured on that device. Try again.");
        return;
      }
      setTakeoverError(null);
      setConflict(false);
      setFinishedElsewhere(outcome.kind === "finished");
      setGone(outcome.kind === "gone");
    },
    onError: (mutationError) => {
      setTakeoverError(parseErrorMessage(mutationError, "Could not take over this match."));
    },
  });

  function declineTakeover() {
    setConflict(false);
    setTakeoverError(null);
  }

  return {
    matchId,
    conflict,
    finishedElsewhere,
    gone,
    takingOver,
    takeoverError,
    takeOver: () => {
      takeOver();
    },
    declineTakeover,
  };
}
