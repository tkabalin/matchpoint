import {
  zMatchCreate,
  zMatchRead,
  zMatchUpdate,
  zPointBatch,
  zScoreCheckpointBatch,
} from "@matchpoint/api-client/zod";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ScoreCheckpoint } from "@/features/capture/checkpoint";
import { createMatch } from "@/features/capture/match";
import { outboxDb, type OutboxEntry, type OutboxFailure } from "@/features/outbox/db";
import { appendEvent, findInProgressFor, readLog, saveMatch } from "@/features/outbox/match-log";
import {
  append,
  markFailed,
  readByMatch,
  readPending,
  remove,
  removeByMatch,
} from "@/features/outbox/outbox";

import { BACKOFF_DELAYS_MS, drainOutbox, MAX_POINTS_PER_BATCH } from "./drain";

// Spies with real implementations passing through, so one test can reject a
// single outbox read the way a schema upgrade in another tab would.
vi.mock(import("@/features/outbox/outbox"), { spy: true });

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const DEVICE_ID = "de1ce000-0000-4000-8000-000000000001";
const MATCH_A = "3f1c2b4e-0000-4000-8000-00000000000a";
const MATCH_B = "3f1c2b4e-0000-4000-8000-00000000000b";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

/**
 * Entity ids must be real UUIDs: the generated schemas check the format, so a
 * bare "p1" would be recorded as a contract violation below. The hex tag keeps
 * the assertions readable.
 */
function uid(tag: string): string {
  return `00000000-0000-4000-8000-${tag.padStart(12, "0")}`;
}

function matchEntry(matchId: string): OutboxEntry {
  const match = createMatch("2026-08-15", PLAYER_ID, { opponentId: OPPONENT_ID }, PLAYER_ID);
  // createMatch mints its own id; the queue needs this row keyed by the fixture's.
  return {
    id: matchId,
    coachId: COACH_ID,
    matchId,
    kind: "match",
    payload: { ...match.toJSON(), matchId },
  };
}

function pointEntry(
  tag: string,
  matchId: string,
  sequence: number,
  payload: Record<string, unknown> = {},
): OutboxEntry {
  const id = uid(tag);
  return {
    id,
    coachId: COACH_ID,
    matchId,
    kind: "point",
    payload: {
      id,
      matchId,
      timestamp: 1_755_600_000_000,
      sequence,
      server: "TRACKED",
      courtSide: "DEUCE",
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
      note: null,
      wing: null,
      shotType: null,
      ballIn: null,
      ballLocation: null,
      rallyLengthBucket: null,
      ...payload,
    },
  };
}

/** The outcome row `endMatch` queues — see live-match.tsx and match-outcome-payload.ts. */
function outcomeEntry(matchId: string, trackedPlayerWon = true): OutboxEntry {
  return {
    id: `${matchId}:outcome`,
    coachId: COACH_ID,
    matchId,
    kind: "matchOutcome",
    payload: { reason: "retirement", trackedPlayerWon },
  };
}

/** A checkpoint row: one set in progress at 2-1, love-all in the current game. */
function checkpointEntry(tag: string, matchId: string, sequence: number): OutboxEntry {
  const id = uid(tag);
  const checkpoint = ScoreCheckpoint.create({
    id,
    matchId,
    timestamp: 1_755_600_000_000,
    sequence,
    after: { sets: [{ tracked: 2, opponent: 1, tiebreak: null }], game: null },
    servesNext: "TRACKED",
    orderChanged: false,
  });
  return { id, coachId: COACH_ID, matchId, kind: "checkpoint", payload: checkpoint.toJSON() };
}

/** The row `undo()` queues for a point or checkpoint it just popped off the log. */
function eventDeleteEntry(
  kind: "point" | "checkpoint",
  targetId: string,
  matchId: string,
): OutboxEntry {
  return {
    id: `${targetId}:delete`,
    coachId: COACH_ID,
    matchId,
    kind: "eventDelete",
    payload: { kind },
  };
}

/** A point carrying the longest note the API takes, for the byte-bound test. */
function notedPointEntry(tag: string, matchId: string, sequence: number): OutboxEntry {
  return pointEntry(tag, matchId, sequence, { note: "x".repeat(2_000) });
}

async function queue(...entries: OutboxEntry[]): Promise<void> {
  for (const entry of entries) {
    const result = await append(entry);
    if (!result.ok) throw new Error(`fixture append failed: ${result.reason}`);
  }
}

/** The API's own ceiling, in bytes rather than characters (body_limit.py). */
const MAX_REQUEST_BODY_BYTES = 1_000_000;

interface RecordedRequest {
  method: string;
  pathname: string;
  body: unknown;
}

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

// A body that fails its schema is recorded here and answered with a 400, and
// the afterEach below fails the test over it. Not thrown inside the stub: the
// client would swallow the throw as a network failure and the engine would
// back off for seconds of real time before the test could say why.
const contractViolations: string[] = [];

/**
 * Stubs the transport, not the engine's collaborators, for the same reason as
 * sign-in.test.tsx. Every body the engine builds is parsed with the schema
 * generated from the API's own spec, which is the check the TypeScript types
 * cannot make (formats and length bounds erase to `string`), so a drain that
 * built an invalid request fails here, not live.
 */
function stubTransport(respond: Responder): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      // A delete carries no body at all, unlike every other request this engine
      // sends: `.json()` on an empty stream throws, so read text first.
      const text = await request.clone().text();
      const recorded: RecordedRequest = {
        method: request.method,
        // Minus the client's /api base path: that prefix belongs to the proxy
        // config, the route below it is what the engine chooses.
        pathname: new URL(request.url).pathname.replace(/^\/api/, ""),
        body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
      };
      requests.push(recorded);
      const schema =
        recorded.pathname === "/matches"
          ? zMatchCreate
          : /^\/matches\/[^/]+\/points$/.test(recorded.pathname)
            ? zPointBatch
            : /^\/matches\/[^/]+\/score-checkpoints$/.test(recorded.pathname)
              ? zScoreCheckpointBatch
              : recorded.method === "PATCH" && /^\/matches\/[^/]+$/.test(recorded.pathname)
                ? zMatchUpdate
                : null;
      const parsed = schema?.safeParse(recorded.body);
      if (parsed?.success === false) {
        contractViolations.push(`${recorded.pathname}: ${parsed.error.message}`);
        return jsonResponse(400, { detail: "request violated the generated contract" });
      }
      return respond(recorded);
    }),
  );
  return requests;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** A spec-shaped success: 201 with a MatchRead body echoing the create. */
function matchCreated(body: unknown): Response {
  const create = zMatchCreate.parse(body);
  return jsonResponse(
    201,
    zMatchRead.parse({
      id: create.id,
      player_id: create.player_id,
      opponent_name: create.opponent_name ?? null,
      played_on: create.played_on,
      surface: create.surface ?? null,
      event: create.event ?? null,
      scoring_system: create.scoring_system ?? null,
      result: null,
      created_at: "2026-08-20T10:00:00Z",
      updated_at: "2026-08-20T10:00:00Z",
    }),
  );
}

/** Routes every request to its happy answer; ingest returns derived set rows. */
function respondOk(request: RecordedRequest): Response {
  if (request.pathname === "/matches") return matchCreated(request.body);
  return jsonResponse(200, []);
}

function drain() {
  return drainOutbox(COACH_ID, DEVICE_ID);
}

async function pendingIds(): Promise<string[]> {
  return (await readPending(COACH_ID)).map((row) => row.id);
}

/**
 * Lets fake-indexeddb's and fetch's queued work run while setTimeout stays
 * fake: both settle on real macrotasks (setImmediate is deliberately not in
 * `toFake`), so a bounded number of turns finishes any in-flight sweep.
 */
async function ticks(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function useFakeDelays(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/** Drives a drain with fake timers to completion, however long it backs off. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    await ticks();
    await vi.advanceTimersByTimeAsync(60_000);
  }
  return promise;
}

beforeEach(async () => {
  await outboxDb.delete();
  await outboxDb.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  expect(contractViolations.splice(0)).toEqual([]);
});

describe("flushing", () => {
  test("creates the match first, then flushes its points in enqueue order", async () => {
    const requests = stubTransport(respondOk);
    await queue(matchEntry(MATCH_A), pointEntry("a1", MATCH_A, 0), pointEntry("a2", MATCH_A, 1));

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
    ]);
    const batch = zPointBatch.parse(requests[1]!.body);
    expect(batch.device_id).toBe(DEVICE_ID);
    expect(batch.points.map((point) => point.id)).toEqual([uid("a1"), uid("a2")]);
    expect(await pendingIds()).toEqual([]);
    expect(result).toEqual({
      acknowledged: 3,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });

  test("groups interleaved rows by match, matches in first-queued order", async () => {
    const requests = stubTransport(respondOk);
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
      pointEntry("a2", MATCH_A, 1),
    );

    await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
      "/matches",
      `/matches/${MATCH_B}/points`,
    ]);
    expect(zPointBatch.parse(requests[1]!.body).points.map((point) => point.id)).toEqual([
      uid("a1"),
      uid("a2"),
    ]);
  });

  test("flushes points straight away for a match created on an earlier run", async () => {
    const requests = stubTransport(respondOk);
    await queue(pointEntry("a1", MATCH_A, 0));

    await drain();

    expect(requests.map((request) => request.pathname)).toEqual([`/matches/${MATCH_A}/points`]);
  });

  test("chunks a long queue at the batch ceiling", async () => {
    const requests = stubTransport(respondOk);
    // bulkAdd rather than 501 append transactions; the shape matches append's.
    await outboxDb.entries.bulkAdd(
      Array.from({ length: MAX_POINTS_PER_BATCH + 1 }, (_, index) => ({
        ...pointEntry(index.toString(16), MATCH_A, index),
        status: "pending" as const,
        schemaVersion: 1,
      })),
    );

    const result = await drain();

    // zPointBatch (parsed in the transport stub) carries the spec's maxItems,
    // so an over-full first chunk fails there rather than by this count alone.
    const sizes = requests.map((request) => zPointBatch.parse(request.body).points.length);
    expect(sizes).toEqual([MAX_POINTS_PER_BATCH, 1]);
    expect(result.acknowledged).toBe(MAX_POINTS_PER_BATCH + 1);
    expect(await pendingIds()).toEqual([]);
  });

  test("closes a batch on the body limit before the count ceiling", async () => {
    const requests = stubTransport(respondOk);
    // Every point carries the longest note the API takes, so the count ceiling's
    // worth of them is over the 1 MB body limit while still under that ceiling.
    await outboxDb.entries.bulkAdd(
      Array.from({ length: MAX_POINTS_PER_BATCH }, (_, index) => ({
        ...notedPointEntry(index.toString(16), MATCH_A, index),
        status: "pending" as const,
        schemaVersion: 1,
      })),
    );

    const result = await drain();

    // A 413 parks permanently and a retry rebuilds the same body, so the split
    // has to happen before the request, not in answer to one.
    expect(requests.length).toBeGreaterThan(1);
    expect(zPointBatch.parse(requests[0]!.body).points.length).toBeLessThan(MAX_POINTS_PER_BATCH);
    for (const request of requests) {
      expect(new TextEncoder().encode(JSON.stringify(request.body)).length).toBeLessThanOrEqual(
        MAX_REQUEST_BODY_BYTES,
      );
    }
    expect(result.acknowledged).toBe(MAX_POINTS_PER_BATCH);
    expect(await pendingIds()).toEqual([]);
  });

  test("tolerates a row deleted while the drain is mid-flight", async () => {
    // The coach undoes B's second point while A's create is on the wire; B's
    // rows are re-read just before B is flushed, so the batch no longer has it.
    const requests = stubTransport(async (request) => {
      if (request.pathname === "/matches" && zMatchCreate.parse(request.body).id === MATCH_A) {
        await remove([uid("b2")]);
      }
      return respondOk(request);
    });
    await queue(
      matchEntry(MATCH_A),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
      pointEntry("b2", MATCH_B, 1),
    );

    await drain();

    const batch = zPointBatch.parse(requests.at(-1)!.body);
    expect(batch.points.map((point) => point.id)).toEqual([uid("b1")]);
    expect(await pendingIds()).toEqual([]);
  });

  test("sends nothing for a match purged while the drain is mid-flight", async () => {
    // The coach deletes match B while A's create is on the wire. B's rows are
    // re-read just before B would be flushed, so the purge wins and B never
    // goes out. A purge of the match in flight is the server's to settle.
    const requests = stubTransport(async (request) => {
      if (request.pathname === "/matches" && zMatchCreate.parse(request.body).id === MATCH_A) {
        await removeByMatch(MATCH_B);
      }
      return respondOk(request);
    });
    await queue(
      matchEntry(MATCH_A),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
      pointEntry("b2", MATCH_B, 1),
    );

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual(["/matches"]);
    expect(await readByMatch(MATCH_B)).toEqual([]);
    expect(result).toEqual({
      acknowledged: 1,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });
});

describe("score checkpoints", () => {
  test("sends a checkpoint after the match's points, batched like a point", async () => {
    const requests = stubTransport(respondOk);
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      checkpointEntry("a2", MATCH_A, 1),
    );

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_A}/score-checkpoints`,
    ]);
    const batch = zScoreCheckpointBatch.parse(requests[2]!.body);
    expect(batch.device_id).toBe(DEVICE_ID);
    expect(batch.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([uid("a2")]);
    expect(await pendingIds()).toEqual([]);
    expect(result).toMatchObject({ acknowledged: 3 });
  });

  test("maps a checkpoint off the match log once its own create has already landed", async () => {
    const match = createMatch("2026-08-15", PLAYER_ID, { opponentId: OPPONENT_ID }, PLAYER_ID);
    await saveMatch({
      matchId: MATCH_A,
      coachId: COACH_ID,
      trackedPlayerId: PLAYER_ID,
      nextSequence: 1,
      finished: false,
      updatedAt: Date.now(),
      payload: { ...match.toJSON(), matchId: MATCH_A },
    });
    const requests = stubTransport(respondOk);
    await queue(checkpointEntry("a1", MATCH_A, 0));

    await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      `/matches/${MATCH_A}/score-checkpoints`,
    ]);
    expect(await pendingIds()).toEqual([]);
  });

  test("parks a checkpoint the drain has no logged match to map it against", async () => {
    const requests = stubTransport(respondOk);
    await queue(checkpointEntry("a1", MATCH_A, 0));

    const result = await drain();

    expect(requests).toEqual([]);
    const [row] = await readByMatch(MATCH_A);
    expect(row!.status).toBe("failed");
    // A missing match log isn't a bad payload — the checkpoint itself is fine —
    // so this must not read like the generic "app version cannot map it" failure
    // an actually malformed payload gets.
    expect(row!.failure?.message).toMatch(/local record is missing/);
    expect(result).toMatchObject({ parked: 1 });
  });
});

describe("event deletes", () => {
  test("deletes a point and a checkpoint by the id undo queued", async () => {
    const requests = stubTransport(respondOk);
    await queue(
      matchEntry(MATCH_A),
      eventDeleteEntry("point", uid("a1"), MATCH_A),
      eventDeleteEntry("checkpoint", uid("a2"), MATCH_A),
    );

    const result = await drain();

    expect(
      requests.map((request) => ({ method: request.method, pathname: request.pathname })),
    ).toEqual([
      { method: "POST", pathname: "/matches" },
      { method: "DELETE", pathname: `/matches/${MATCH_A}/points/${uid("a1")}` },
      { method: "DELETE", pathname: `/matches/${MATCH_A}/score-checkpoints/${uid("a2")}` },
    ]);
    expect(await pendingIds()).toEqual([]);
    expect(result).toMatchObject({ acknowledged: 3 });
  });

  test("parks one refused delete and still sends the next, independent, delete", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points/${uid("a1")}`
        ? jsonResponse(409, { detail: "Match is completed" })
        : respondOk(request),
    );
    await queue(
      eventDeleteEntry("point", uid("a1"), MATCH_A),
      eventDeleteEntry("checkpoint", uid("a2"), MATCH_A),
    );

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      `/matches/${MATCH_A}/points/${uid("a1")}`,
      `/matches/${MATCH_A}/score-checkpoints/${uid("a2")}`,
    ]);
    // The checkpoint delete's own success removes its row; the point delete's
    // refusal is the only one left to have parked.
    const rows = await readByMatch(MATCH_A);
    expect(rows.map((row) => row.status)).toEqual(["failed"]);
    expect(result).toMatchObject({ parked: 1, acknowledged: 1 });
  });

  // A refused delete parks alone (siblings are independent), but the outcome must
  // still wait: sending it anyway would complete the match with a delete it should
  // have erased still sitting in its stats, and the parked delete would then 409
  // forever once the match is done.
  test("holds the outcome back when an event delete is refused", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points/${uid("a1")}`
        ? jsonResponse(409, { detail: "Match is completed" })
        : respondOk(request),
    );
    await queue(
      matchEntry(MATCH_A),
      eventDeleteEntry("point", uid("a1"), MATCH_A),
      eventDeleteEntry("checkpoint", uid("a2"), MATCH_A),
      outcomeEntry(MATCH_A),
    );

    const result = await drain();

    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    expect(await pendingIds()).toEqual([`${MATCH_A}:outcome`]);
    expect(result).toMatchObject({ parked: 1 });
  });

  test("discards every queued delete together once one of them turns out to be gone", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points/${uid("a1")}`
        ? jsonResponse(410, { detail: "This match was deleted." })
        : respondOk(request),
    );
    await queue(
      eventDeleteEntry("point", uid("a1"), MATCH_A),
      eventDeleteEntry("checkpoint", uid("a2"), MATCH_A),
    );

    const result = await drain();

    // Only the first delete goes out: the 410 it gets discards the rest of the
    // match's queued deletes with it, rather than 410ing them one at a time.
    expect(requests.map((request) => request.pathname)).toEqual([
      `/matches/${MATCH_A}/points/${uid("a1")}`,
    ]);
    expect(await readByMatch(MATCH_A)).toEqual([]);
    expect(result).toMatchObject({ discarded: 2 });
  });
});

describe("match outcome", () => {
  // The bug this whole change fixes (#268's web half): a checkpoint or an event
  // delete used to hold the outcome back forever, since nothing ever sent them.
  test("sends the outcome once a checkpoint and an event delete both land", async () => {
    const requests = stubTransport(respondOk);
    await queue(
      matchEntry(MATCH_A),
      checkpointEntry("a1", MATCH_A, 0),
      eventDeleteEntry("point", uid("a2"), MATCH_A),
      outcomeEntry(MATCH_A),
    );

    const result = await drain();

    expect(
      requests.map((request) => ({ method: request.method, pathname: request.pathname })),
    ).toEqual([
      { method: "POST", pathname: "/matches" },
      { method: "POST", pathname: `/matches/${MATCH_A}/score-checkpoints` },
      { method: "DELETE", pathname: `/matches/${MATCH_A}/points/${uid("a2")}` },
      { method: "PATCH", pathname: `/matches/${MATCH_A}` },
    ]);
    expect(await pendingIds()).toEqual([]);
    expect(result).toMatchObject({ acknowledged: 4 });
  });

  test("sends the outcome as its own request, right after the match create", async () => {
    const requests = stubTransport(respondOk);
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A));

    const result = await drain();

    expect(
      requests.map((request) => ({ method: request.method, pathname: request.pathname })),
    ).toEqual([
      { method: "POST", pathname: "/matches" },
      { method: "PATCH", pathname: `/matches/${MATCH_A}` },
    ]);
    expect(zMatchUpdate.parse(requests[1]!.body)).toEqual({ result: "win" });
    expect(await readByMatch(MATCH_A)).toEqual([]);
    expect(result).toEqual({
      acknowledged: 2,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });

  test("sends the outcome for a match whose create already landed on an earlier run", async () => {
    const requests = stubTransport(respondOk);
    await queue(outcomeEntry(MATCH_A, false));

    await drain();

    expect(requests.map((request) => request.pathname)).toEqual([`/matches/${MATCH_A}`]);
    expect(zMatchUpdate.parse(requests[0]!.body)).toEqual({ result: "loss" });
  });

  // The outcome and the points are independent requests either way: a batch this
  // app version cannot map yet (#210) must not hold the outcome back, and — the
  // opposite direction, below — a refused outcome must not hold the points back.
  // The outcome is what completes the match server-side, and ingest_points refuses a
  // completed match: sending it while a point is parked would fence that point out for
  // good rather than leaving it to be retried.
  test("holds the outcome back when the match's points are refused", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points`
        ? jsonResponse(422, {
            detail: [{ loc: ["body", "points", 0], msg: "bad point", type: "value_error" }],
          })
        : respondOk(request),
    );
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
    ]);
    expect(result).toMatchObject({ acknowledged: 1, parked: 1 });
    expect(await pendingIds()).toEqual([`${MATCH_A}:outcome`]);
  });

  test("sends the outcome after the match's points, never before them", async () => {
    const requests = stubTransport(respondOk);
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_A}`,
    ]);
    expect(await pendingIds()).toEqual([]);
  });

  // A transient failure means the point has simply not been sent yet, so completing the
  // match would fence it out on the next attempt rather than let it retry.
  test("holds the outcome back when a point batch was only transiently refused", async () => {
    useFakeDelays();
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points`
        ? jsonResponse(503, { detail: "down" })
        : respondOk(request),
    );
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    const result = await settle(drain());

    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    // Nothing parked: the point and the outcome are both still owed.
    expect(result).toMatchObject({ parked: 0 });
    expect(await pendingIds()).toEqual([`${MATCH_A}:outcome`, uid("a1")]);
  });

  test("parks a refused outcome without touching the match's points", async () => {
    const requests = stubTransport((request) =>
      request.method === "PATCH"
        ? jsonResponse(409, {
            detail: "A completed match's result or scoring system cannot be changed",
          })
        : respondOk(request),
    );
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_A}`,
    ]);
    const outcomeRow = (await readByMatch(MATCH_A)).find((row) => row.kind === "matchOutcome");
    expect(outcomeRow?.status).toBe("failed");
    expect(outcomeRow?.failure).toEqual({
      status: 409,
      message: "A completed match's result or scoring system cannot be changed",
    });
    expect(result).toMatchObject({ acknowledged: 2, parked: 1 });
  });

  test("parks an outcome payload this app version cannot map", async () => {
    const requests = stubTransport(respondOk);
    await queue(matchEntry(MATCH_A), {
      id: `${MATCH_A}:outcome`,
      coachId: COACH_ID,
      matchId: MATCH_A,
      kind: "matchOutcome",
      payload: { schema: "from-a-future-app-version" },
    });

    await drain();

    const outcomeRow = (await readByMatch(MATCH_A)).find((row) => row.kind === "matchOutcome");
    expect(outcomeRow?.status).toBe("failed");
    expect(outcomeRow?.failure).toEqual({ status: null, message: expect.any(String) });
    expect(requests.map((request) => request.pathname)).toEqual(["/matches"]);
  });

  test("discards an outcome for a match the server says was deleted", async () => {
    stubTransport((request) =>
      request.method === "PATCH"
        ? jsonResponse(410, { detail: "This match was deleted." })
        : respondOk(request),
    );
    // The create already landed on an earlier run — only the outcome is queued.
    await queue(outcomeEntry(MATCH_A));

    const result = await drain();

    expect(await readByMatch(MATCH_A)).toEqual([]);
    expect(result).toEqual({
      acknowledged: 0,
      discarded: 1,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });
});

describe("refusals", () => {
  test("parks a refused match and its points, with the reason, without blocking others", async () => {
    stubTransport((request) => {
      if (request.pathname === "/matches" && zMatchCreate.parse(request.body).id === MATCH_A) {
        return jsonResponse(409, { detail: "That player has been archived." });
      }
      return respondOk(request);
    });
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
    );

    const result = await drain();

    const parkedA = await readByMatch(MATCH_A);
    expect(parkedA.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(parkedA.map((row) => row.failure)).toEqual(
      Array<OutboxFailure>(2).fill({ status: 409, message: "That player has been archived." }),
    );
    expect(await readByMatch(MATCH_B)).toEqual([]);
    expect(result).toEqual({
      acknowledged: 2,
      discarded: 0,
      parked: 2,
      unauthorized: false,
      skipped: false,
    });
  });

  test("parks a refused match's checkpoint and eventDelete rows alongside its match and points", async () => {
    stubTransport((request) =>
      request.pathname === "/matches"
        ? jsonResponse(409, { detail: "That player has been archived." })
        : respondOk(request),
    );
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      checkpointEntry("a2", MATCH_A, 1),
      eventDeleteEntry("point", uid("a3"), MATCH_A),
    );

    const result = await drain();

    // The match create never lands, so nothing behind it — points, checkpoints
    // and deletes alike — can be sent either; all four park together.
    expect((await readByMatch(MATCH_A)).map((row) => [row.kind, row.status])).toEqual([
      ["match", "failed"],
      ["point", "failed"],
      ["checkpoint", "failed"],
      ["eventDelete", "failed"],
    ]);
    expect(result).toMatchObject({ parked: 4 });
  });

  test("parks a refused point batch with the 422's own words, never retrying it", async () => {
    const requests = stubTransport((request) =>
      request.pathname === "/matches"
        ? respondOk(request)
        : jsonResponse(422, {
            detail: [
              {
                loc: ["body", "points", 0, "sequence"],
                msg: "stamp out of range",
                type: "value_error",
              },
            ],
          }),
    );
    await queue(pointEntry("a1", MATCH_A, 0), pointEntry("a2", MATCH_A, 1));

    await drain();

    const rows = await readByMatch(MATCH_A);
    expect(rows.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(rows[0]!.failure).toEqual({ status: 422, message: "stamp out of range" });
    // Permanent means one attempt: a poison batch must not loop forever.
    expect(requests).toHaveLength(1);
  });

  test("skips every batch of a match whose earlier rows are parked", async () => {
    const requests = stubTransport(respondOk);
    await queue(matchEntry(MATCH_A), pointEntry("a1", MATCH_A, 0), matchEntry(MATCH_B));
    await markFailed([MATCH_A, uid("a1")], {
      status: 409,
      message: "That player has been archived.",
    });
    // Capture keeps tapping after the park; this lands pending, match invisible.
    await queue(pointEntry("a2", MATCH_A, 1));

    await drain();

    // Nothing of A's goes out: the server rejects any batch for a match it
    // refused, so flushing a2 would only grow the failed count every cycle.
    expect(requests.map((request) => request.pathname)).toEqual(["/matches"]);
    expect(await pendingIds()).toEqual([uid("a2")]);
  });

  test("parks a payload this app version cannot map, keeping its cause", async () => {
    const requests = stubTransport(respondOk);
    await queue({
      id: uid("bad1"),
      coachId: COACH_ID,
      matchId: MATCH_A,
      kind: "point",
      payload: { schema: "from-a-future-app-version" },
    });

    await drain();

    const [row] = await readByMatch(MATCH_A);
    expect(row!.status).toBe("failed");
    expect(row!.failure).toEqual({ status: null, message: expect.stringContaining("point") });
    expect(requests).toEqual([]);
  });

  // The match row is mapped before any request goes out, so an unmappable one has to
  // take its points down with it: ingesting them against a match that was never
  // created is the failure this ordering exists to prevent.
  test("parks an unmappable match with its own points, before any request", async () => {
    const requests = stubTransport(respondOk);
    await queue(
      {
        id: MATCH_A,
        coachId: COACH_ID,
        matchId: MATCH_A,
        kind: "match",
        payload: { schema: "from-a-future-app-version" },
      },
      pointEntry("a1", MATCH_A, 0),
    );

    const result = await drain();

    const parked = await readByMatch(MATCH_A);
    expect(parked.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(parked[0]!.failure).toEqual({ status: null, message: expect.any(String) });
    expect(requests).toEqual([]);
    expect(result.parked).toBe(2);
  });
});

// Both statuses mean no retry can ever land these rows. Which one it is says
// whether the coach chose the loss: only the 410 tombstone does, so only it is
// swallowed, and the engine tells them apart on the status alone.
describe("rows that can never land", () => {
  test("discards a match the server says was deleted, without parking anything", async () => {
    stubTransport((request) => {
      if (request.pathname === "/matches" && zMatchCreate.parse(request.body).id === MATCH_A) {
        // #214's tombstone, for a match id deleted inside the window. The engine
        // reads the status and never this sentence.
        return jsonResponse(410, { detail: "This match was deleted." });
      }
      return respondOk(request);
    });
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
    );

    const result = await drain();

    // Gone from the queue rather than parked: the coach deleted the match, so a
    // failed count would ask them to act on their own decision.
    expect(await readByMatch(MATCH_A)).toEqual([]);
    expect(await readByMatch(MATCH_B)).toEqual([]);
    expect(result).toEqual({
      acknowledged: 2,
      discarded: 2,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });

  test("forgets a deleted match's log, so capture cannot resume into it", async () => {
    stubTransport((request) =>
      request.pathname === "/matches"
        ? jsonResponse(410, { detail: "This match was deleted." })
        : respondOk(request),
    );
    await queue(matchEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));
    await saveMatch({
      matchId: MATCH_A,
      coachId: COACH_ID,
      trackedPlayerId: PLAYER_ID,
      nextSequence: 1,
      finished: false,
      updatedAt: 1_755_600_000_000,
      payload: matchEntry(MATCH_A).payload,
    });
    await appendEvent({
      id: uid("a1"),
      matchId: MATCH_A,
      coachId: COACH_ID,
      sequence: 0,
      kind: "point",
      payload: pointEntry("a1", MATCH_A, 0).payload,
    });

    await drain();

    // The delete was the coach's, made on another device; a log left behind would
    // offer the match back on this one as something still being captured.
    expect(await findInProgressFor(COACH_ID, PLAYER_ID)).toBeUndefined();
    expect(await readLog(MATCH_A)).toEqual([]);
  });

  test("discards the points of a deleted match and flushes the next one", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points`
        ? jsonResponse(410, { detail: "This match was deleted." })
        : respondOk(request),
    );
    // A's create landed on an earlier run, so only its points are queued.
    await queue(
      pointEntry("a1", MATCH_A, 0),
      pointEntry("a2", MATCH_A, 1),
      pointEntry("b1", MATCH_B, 0),
    );

    const result = await drain();

    expect(await readByMatch(MATCH_A)).toEqual([]);
    // One attempt at A, and B still goes out: unlandable is permanent, and it
    // is one match's answer rather than the run's.
    expect(requests.map((request) => request.pathname)).toEqual([
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_B}/points`,
    ]);
    expect(result.discarded).toBe(2);
    expect(result.parked).toBe(0);
  });

  test("parks a match whose player the server will not accept", async () => {
    stubTransport((request) => {
      if (request.pathname === "/matches" && zMatchCreate.parse(request.body).id === MATCH_A) {
        // What a transfer of the player to another coach answers. The match is
        // the coach's own recorded work, so it has to stay where they can see it.
        return jsonResponse(404, { detail: "Unknown player_id" });
      }
      return respondOk(request);
    });
    await queue(matchEntry(MATCH_A), pointEntry("a1", MATCH_A, 0), matchEntry(MATCH_B));

    const result = await drain();

    const parked = await readByMatch(MATCH_A);
    expect(parked.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(parked[0]!.failure).toEqual({ status: 404, message: "Unknown player_id" });
    expect(result.discarded).toBe(0);
    expect(result.parked).toBe(2);
  });

  test("parks the points of a match the server cannot find", async () => {
    const requests = stubTransport((request) =>
      request.pathname === `/matches/${MATCH_A}/points`
        ? jsonResponse(404, { detail: "Match not found" })
        : respondOk(request),
    );
    await queue(
      pointEntry("a1", MATCH_A, 0),
      pointEntry("a2", MATCH_A, 1),
      pointEntry("b1", MATCH_B, 0),
    );

    const result = await drain();

    const parked = await readByMatch(MATCH_A);
    expect(parked.map((row) => row.failure)).toEqual(
      Array<OutboxFailure>(2).fill({ status: 404, message: "Match not found" }),
    );
    // Parked, not retried, and B is untouched by A's answer.
    expect(requests.map((request) => request.pathname)).toEqual([
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_B}/points`,
    ]);
    expect(result.discarded).toBe(0);
    expect(result.parked).toBe(2);
  });
});

describe("halting and retrying", () => {
  test("halts everything on a 401 and keeps the queue intact", async () => {
    const requests = stubTransport(() => jsonResponse(401, { detail: "Not signed in" }));
    await queue(
      matchEntry(MATCH_A),
      pointEntry("a1", MATCH_A, 0),
      matchEntry(MATCH_B),
      pointEntry("b1", MATCH_B, 0),
    );

    const result = await drain();

    // One request, no parking, no backoff: a revoked session must never cost a
    // match, and whether it is really over is the next sign-in's question.
    expect(requests).toHaveLength(1);
    expect(await pendingIds()).toHaveLength(4);
    expect(result).toEqual({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: true,
      skipped: false,
    });
  });

  // The test above halts at the match create, because its queue starts with one. A
  // match already acknowledged leaves point ingest as the first call the sweep makes,
  // and that verdict is reached by its own switch.
  test("halts on a 401 from point ingest too, with no match row ahead of it", async () => {
    const requests = stubTransport(() => jsonResponse(401, { detail: "Not signed in" }));
    await queue(pointEntry("a1", MATCH_A, 0), pointEntry("a2", MATCH_A, 1));

    const result = await drain();

    expect(requests).toHaveLength(1);
    expect(await pendingIds()).toEqual([uid("a1"), uid("a2")]);
    expect(result).toEqual({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: true,
      skipped: false,
    });
  });

  // Same shape again: the create already lands, and the outcome PATCH is what
  // returns 401 this time, halting before the point behind it is ever attempted.
  test("halts on a 401 from the outcome PATCH too", async () => {
    const requests = stubTransport((request) =>
      request.method === "PATCH"
        ? jsonResponse(401, { detail: "Not signed in" })
        : respondOk(request),
    );
    await queue(matchEntry(MATCH_A), outcomeEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    const result = await drain();

    expect(requests.map((request) => request.pathname)).toEqual([
      "/matches",
      `/matches/${MATCH_A}/points`,
      `/matches/${MATCH_A}`,
    ]);
    expect(await pendingIds()).toEqual([`${MATCH_A}:outcome`]);
    expect(result).toEqual({
      acknowledged: 2,
      discarded: 0,
      parked: 0,
      unauthorized: true,
      skipped: false,
    });
  });

  test("retries a network failure on the backoff schedule, then succeeds", async () => {
    useFakeDelays();
    let failures = 2;
    const requests = stubTransport((request) => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError("fetch failed");
      }
      return respondOk(request);
    });
    await queue(pointEntry("a1", MATCH_A, 0));

    const run = drain();
    await ticks();
    expect(requests).toHaveLength(1);

    // Not a moment before the schedule says so.
    await vi.advanceTimersByTimeAsync(BACKOFF_DELAYS_MS[0]! - 1);
    await ticks();
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await ticks();
    expect(requests).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(BACKOFF_DELAYS_MS[1]!);
    await ticks();
    expect(requests).toHaveLength(3);

    expect(await settle(run)).toEqual({
      acknowledged: 1,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
    expect(await pendingIds()).toEqual([]);
  });

  test("gives up after the schedule and leaves the rows pending", async () => {
    useFakeDelays();
    const requests = stubTransport(() => jsonResponse(503, { detail: "down" }));
    await queue(pointEntry("a1", MATCH_A, 0));

    const result = await settle(drain());

    expect(requests).toHaveLength(1 + BACKOFF_DELAYS_MS.length);
    expect(await pendingIds()).toEqual([uid("a1")]);
    expect(result).toEqual({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });

  // Same schedule, but exhausted against the match create rather than point ingest:
  // the create's own transient branch has to leave the match pending, or its points
  // would later be ingested against a match that was never made.
  test("gives up on a failing match create and leaves the match and its points pending", async () => {
    useFakeDelays();
    const requests = stubTransport(() => jsonResponse(503, { detail: "down" }));
    await queue(matchEntry(MATCH_A), pointEntry("a1", MATCH_A, 0));

    const result = await settle(drain());

    expect(requests).toHaveLength(1 + BACKOFF_DELAYS_MS.length);
    expect(await pendingIds()).toHaveLength(2);
    expect(result).toEqual({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: false,
    });
  });

  test("waits out a 429's Retry-After when it outlasts the backoff step", async () => {
    useFakeDelays();
    let limited = true;
    const requests = stubTransport((request) => {
      if (limited) {
        limited = false;
        return jsonResponse(429, { detail: "Too many requests" }, { "Retry-After": "30" });
      }
      return respondOk(request);
    });
    await queue(pointEntry("a1", MATCH_A, 0));

    const run = drain();
    await ticks();
    expect(requests).toHaveLength(1);

    // The bucket said 30s; the 1s backoff step must not jump the queue.
    await vi.advanceTimersByTimeAsync(29_999);
    await ticks();
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await ticks();
    expect(requests).toHaveLength(2);
    await settle(run);
    expect(await pendingIds()).toEqual([]);
  });

  test("retries the sweep when another tab's upgrade closes the database", async () => {
    useFakeDelays();
    const requests = stubTransport(respondOk);
    await queue(pointEntry("a1", MATCH_A, 0));
    vi.mocked(readPending).mockRejectedValueOnce(
      Object.assign(new Error("connection closed"), { name: "DatabaseClosedError" }),
    );

    const result = await settle(drain());

    // Self-healing: the connection reopens on the next operation, so the row
    // written before the close still flushes, one backoff step later.
    expect(requests).toHaveLength(1);
    expect(result.acknowledged).toBe(1);
  });
});

describe("the drain lock", () => {
  test("skips, sending nothing, while another drain holds the lock", async () => {
    const requests = stubTransport(respondOk);
    await queue(pointEntry("a1", MATCH_A, 0));
    let release = () => {};
    const held = navigator.locks.request("matchpoint:outbox-drain", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ticks(1);

    const result = await drain();

    expect(result).toEqual({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: true,
    });
    expect(requests).toEqual([]);
    expect(await pendingIds()).toEqual([uid("a1")]);
    release();
    await held;
  });
});
