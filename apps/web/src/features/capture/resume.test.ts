import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import * as matchLog from "@/features/outbox/match-log";
import { appendEvent, saveMatch } from "@/features/outbox/match-log";

import { Match } from "./match";
import { Point } from "./point";
import { restoreInProgress, useInProgressSummary } from "./resume";

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const OTHER_COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c2";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-0000000000m1";

beforeEach(async () => {
  await outboxDb.events.clear();
  await outboxDb.matches.clear();
});

function makeMatch() {
  return Match.create({
    matchId: MATCH_ID,
    playedOn: "2026-08-23",
    trackedPlayerId: PLAYER_ID,
    opponentId: OPPONENT_ID,
    opponentName: null,
    scoringSystem: "traditional",
    firstServer: PLAYER_ID,
    surfaceType: "hard",
    outcomeOverride: null,
  });
}

function pointAt(sequence: number, won: boolean) {
  return Point.create({
    id: `point-${String(sequence)}`,
    matchId: MATCH_ID,
    timestamp: 1_700_000_000_000 + sequence,
    sequence,
    server: "TRACKED",
    courtSide: "DEUCE",
    won,
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
    serves: [],
    returnOutcome: null,
    endReason: null,
    unusualReason: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: null,
    ballLocation: null,
    rallyLengthBucket: null,
  });
}

/** Logs a match with one won point already folded in, the way `queueEvent` in
 *  `live-match.tsx` writes both rows on a real commit. */
async function logAMatchInProgress(overrides: { coachId?: string; finished?: boolean } = {}) {
  const match = makeMatch();
  await saveMatch({
    matchId: MATCH_ID,
    coachId: overrides.coachId ?? COACH_ID,
    trackedPlayerId: PLAYER_ID,
    nextSequence: 1,
    finished: overrides.finished ?? false,
    updatedAt: 1_700_000_000_000,
    payload: match.toJSON(),
  });
  await appendEvent({
    id: "point-0",
    matchId: MATCH_ID,
    coachId: overrides.coachId ?? COACH_ID,
    sequence: 0,
    kind: "point",
    payload: pointAt(0, true).toJSON(),
  });
}

describe("restoreInProgress", () => {
  test("returns null where capture left nothing behind", async () => {
    expect(await restoreInProgress(COACH_ID, PLAYER_ID)).toBeNull();
  });

  test("folds the logged match and its events back into a board", async () => {
    await logAMatchInProgress();

    const restored = await restoreInProgress(COACH_ID, PLAYER_ID);

    expect(restored).not.toBeNull();
    expect(restored?.match.matchId).toBe(MATCH_ID);
    expect(restored?.events).toHaveLength(1);
    expect(restored?.nextSequence).toBe(1);
    expect(restored?.board.game).toEqual({ tracked: 1, opponent: 0 });
  });

  test("throws on a logged event this build cannot read, rather than answering half a match", async () => {
    await logAMatchInProgress();
    await outboxDb.events.toCollection().modify({ payload: { won: "maybe" } });

    await expect(restoreInProgress(COACH_ID, PLAYER_ID)).rejects.toThrow();
  });
});

describe("useInProgressSummary", () => {
  test("is null with nothing logged", async () => {
    const { result } = renderHook(() => useInProgressSummary(COACH_ID));

    await waitFor(() => expect(result.current).toBeNull());
  });

  test("carries the match, a live score line and the log's own updatedAt", async () => {
    await logAMatchInProgress();

    const { result } = renderHook(() => useInProgressSummary(COACH_ID));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.trackedPlayerId).toBe(PLAYER_ID);
    expect(result.current?.scoreLine).toBe("0-0, 15-0");
    expect(result.current?.updatedAt).toBe(1_700_000_000_000);
  });

  test("updates live as the log changes, without a remount", async () => {
    await logAMatchInProgress();
    const { result } = renderHook(() => useInProgressSummary(COACH_ID));
    await waitFor(() => expect(result.current?.scoreLine).toBe("0-0, 15-0"));

    await appendEvent({
      id: "point-1",
      matchId: MATCH_ID,
      coachId: COACH_ID,
      sequence: 1,
      kind: "point",
      payload: pointAt(1, true).toJSON(),
    });
    await saveMatch({
      matchId: MATCH_ID,
      coachId: COACH_ID,
      trackedPlayerId: PLAYER_ID,
      nextSequence: 2,
      finished: false,
      updatedAt: 1_700_000_000_999,
      payload: makeMatch().toJSON(),
    });

    await waitFor(() => expect(result.current?.scoreLine).toBe("0-0, 30-0"));
    expect(result.current?.updatedAt).toBe(1_700_000_000_999);
  });

  test("drops to null once the match is marked finished", async () => {
    await logAMatchInProgress();
    const { result } = renderHook(() => useInProgressSummary(COACH_ID));
    await waitFor(() => expect(result.current).not.toBeNull());

    await logAMatchInProgress({ finished: true });

    await waitFor(() => expect(result.current).toBeNull());
  });

  test("never carries another coach's match", async () => {
    await logAMatchInProgress({ coachId: OTHER_COACH_ID });

    const { result } = renderHook(() => useInProgressSummary(COACH_ID));

    // Nothing to wait for settling: assert it stays null rather than momentarily
    // showing the other coach's match.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeNull();
  });

  test("a null coachId (no owner recorded on this device yet) subscribes to nothing and stays null", () => {
    const { result } = renderHook(() => useInProgressSummary(null));

    expect(result.current).toBeNull();
  });

  // #251 review, finding 5: purgeLocalData clears the query cache before the outbox,
  // so a stale summary must not survive a rerender that finds the coach id gone —
  // signing out and stateRef alike, this is the guard.
  test("clears to null as soon as coachId goes from a coach to null", async () => {
    await logAMatchInProgress();
    const { result, rerender } = renderHook(({ coachId }) => useInProgressSummary(coachId), {
      initialProps: { coachId: COACH_ID as string | null },
    });
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ coachId: null });

    expect(result.current).toBeNull();
  });

  // #251 review, finding 4: every liveQuery emission folds independently and
  // asynchronously, so an older emission's fold can resolve after a newer one's —
  // without the sequence guard this would flip back to the first point's score.
  test("a slower fold for an older emission never overwrites a newer one", async () => {
    await logAMatchInProgress();
    const originalReadLog = matchLog.readLog;
    let calls = 0;
    const readLogSpy = vi.spyOn(matchLog, "readLog").mockImplementation(async (matchId) => {
      calls += 1;
      // Only the first call (the initial emission's fold) is slowed down, so the
      // second emission's fold — triggered by appendEvent below — resolves first.
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 20));
      return originalReadLog(matchId);
    });

    const { result } = renderHook(() => useInProgressSummary(COACH_ID));
    await appendEvent({
      id: "point-1",
      matchId: MATCH_ID,
      coachId: COACH_ID,
      sequence: 1,
      kind: "point",
      payload: pointAt(1, true).toJSON(),
    });

    await waitFor(() => expect(result.current?.scoreLine).toBe("0-0, 30-0"));
    // Give the slow first fold a chance to land, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current?.scoreLine).toBe("0-0, 30-0");

    readLogSpy.mockRestore();
  });
});
