/**
 * The engine that empties the outbox into the API. Pure engine: when to run it
 * is flush-triggers.ts's job.
 *
 * One entry point, drainOutbox. It takes a web lock so two tabs never
 * double-flush, then sweeps the queue: rows grouped by match, the match create
 * first, then its points in enqueue order, in batches bounded by the spec's
 * ceiling and by the body limit, then the outcome PATCH last. The outcome goes
 * last because ingest_points answers 409 for a match whose result is set, so a
 * PATCH sent first would park every point behind it. Every server answer lands
 * in one of five buckets: success removes the rows; a 401 halts the whole run
 * with the queue intact, because a revoked session must never cost a match; a
 * 410 means the match those rows belong to was deliberately deleted, so they are
 * discarded rather than parked; any other 4xx, a 404 included, is a permanent
 * refusal, so the match's rows park as failed with the reason recorded; network
 * errors, 5xx and 429 are transient, so the sweep runs again on a doubling
 * backoff until the schedule runs out. All three requests are idempotent
 * server-side, which is what makes re-sending after a lost acknowledgement safe.
 */

import {
  createMatch,
  ingestPoints,
  updateMatch,
  type ErrorDetail,
  type HttpValidationError,
  type MatchCreate,
  type MatchUpdate,
  type PointCreate,
} from "@matchpoint/api-client";

import { Match } from "@/features/capture/match";
import { Point } from "@/features/capture/point";
import { isDrainableKind, type OutboxFailure, type OutboxRow } from "@/features/outbox/db";
import { markFailed, readByMatch, readPending, remove } from "@/features/outbox/outbox";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";

import { toMatchOutcomeUpdate } from "./match-outcome-payload";
import { toMatchCreate } from "./match-payload";
import { toPointCreate } from "./point-payload";

/**
 * The spec's maxItems on PointBatch.points. drain.test.ts parses every body
 * with zPointBatch, so drift from the real bound fails there, not live.
 */
export const MAX_POINTS_PER_BATCH = 500;

/**
 * The byte ceiling on one batch, under the API's 1 MB body limit. The count
 * bound alone does not hold: a point carrying a note is several times the size
 * of one without, and a 413 parks permanently and rebuilds the same body on
 * retry, so the split has to happen here (see the API's body_limit.py).
 */
export const MAX_BATCH_BYTES = 950_000;

/** Waits between sweeps after a transient failure; give up when they run out. */
export const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

const LOCK_NAME = "matchpoint:outbox-drain";

export interface DrainResult {
  /** Rows the server acknowledged, removed from the queue. */
  acknowledged: number;
  /** Rows removed unsent because their match was deleted (#214). */
  discarded: number;
  /** Rows this run parked as failed. */
  parked: number;
  /** True when a 401 stopped the run: the session is gone, the queue is kept. */
  unauthorized: boolean;
  /** True when another tab held the drain lock, so this run did nothing. */
  skipped: boolean;
}

/** What one pass over the queue adds to the run beyond the row counts. */
interface Sweep {
  acknowledged: number;
  discarded: number;
  parked: number;
  unauthorized: boolean;
  transient: boolean;
  retryAfterSeconds: number | null;
}

/** Flushes everything this coach has queued, as this device. */
export async function drainOutbox(coachId: string, deviceId: string): Promise<DrainResult> {
  const result = await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) =>
    lock === null ? null : await drainWithBackoff(coachId, deviceId),
  );
  return result ?? { acknowledged: 0, discarded: 0, parked: 0, unauthorized: false, skipped: true };
}

/**
 * Whether an error (possibly wrapped, see outbox.ts's isQuotaExceeded for the
 * walk) is Dexie's DatabaseClosedError: another tab upgrading the schema closes
 * this tab's connection mid-operation. Self-healing, the connection reopens on
 * the next operation, so it is the one storage error worth retrying.
 */
export function isDatabaseClosed(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 10 && typeof candidate === "object" && candidate !== null; depth++) {
    const wrapper = candidate as { name?: unknown; inner?: unknown };
    if (wrapper.name === "DatabaseClosedError") return true;
    candidate = wrapper.inner;
  }
  return false;
}

async function drainWithBackoff(coachId: string, deviceId: string): Promise<DrainResult> {
  const totals: DrainResult = {
    acknowledged: 0,
    discarded: 0,
    parked: 0,
    unauthorized: false,
    skipped: false,
  };
  for (let attempt = 0; ; attempt++) {
    const sweep = await sweepQueue(coachId, deviceId);
    totals.acknowledged += sweep.acknowledged;
    totals.discarded += sweep.discarded;
    totals.parked += sweep.parked;
    if (sweep.unauthorized) totals.unauthorized = true;
    const backoff = BACKOFF_DELAYS_MS[attempt];
    if (sweep.unauthorized || !sweep.transient || backoff === undefined) return totals;
    // A 429's Retry-After outranks the schedule: it is our own token bucket
    // saying exactly when the next request stops being wasted.
    await sleep(Math.max(backoff, (sweep.retryAfterSeconds ?? 0) * 1_000));
  }
}

async function sweepQueue(coachId: string, deviceId: string): Promise<Sweep> {
  const sweep: Sweep = {
    acknowledged: 0,
    discarded: 0,
    parked: 0,
    unauthorized: false,
    transient: false,
    retryAfterSeconds: null,
  };
  try {
    const pending = await readPending(coachId);
    for (const matchId of matchIdsInOrder(pending)) {
      // Re-read this one match: the freshest answer to "is its create parked?"
      // (points of a parked match must not flush, the server rejects any batch
      // for a match it refused) and to "which rows still exist?" (undo before
      // sync deletes rows under a running drain).
      const rows = await readByMatch(matchId);
      // One parked row holds the whole match back, its outcome included: sending
      // that PATCH would complete the match server-side and permanently fence
      // out points a `retryFailed` could still land.
      if (rows.some((row) => row.status === "failed")) continue;
      const halt = await flushMatch(rows, deviceId, sweep);
      if (halt) break;
    }
  } catch (cause) {
    if (!isDatabaseClosed(cause)) throw cause;
    sweep.transient = true;
  }
  return sweep;
}

/** First-seen order over pending rows, which readPending gives oldest-first. */
function matchIdsInOrder(rows: readonly OutboxRow[]): string[] {
  return [...new Set(rows.map((row) => row.matchId))];
}

/**
 * Sends one match's rows in the only order the API accepts: the match create, then its
 * points in chunks, then the outcome last.
 *
 * The outcome goes last because `ingest_points` refuses a match whose `result` is set
 * (409). Sending the PATCH first would complete the match and then park every point
 * behind it as permanently failed. For the same reason it is skipped whenever anything
 * earlier in this match did not land: every non-ok branch below returns before reaching
 * it, so a transient failure holds the outcome back rather than fencing off a tail that
 * had simply not been sent yet.
 *
 * Answers true only for a 401, which halts the entire run.
 */
async function flushMatch(
  rows: readonly OutboxRow[],
  deviceId: string,
  sweep: Sweep,
): Promise<boolean> {
  const [first] = rows;
  if (first === undefined) return false;
  const matchRow = rows.find((row) => row.kind === "match");
  const pointRows = rows.filter((row) => row.kind === "point");
  const outcomeRow = rows.find((row) => row.kind === "matchOutcome");
  // Queued by capture, with no endpoint to send them to yet (see
  // docs/scratch/database-changes-needed.md). They sit pending rather than failing, and they hold
  // the outcome back: completing the match would fence out its own checkpoints the
  // moment those endpoints do land.
  const undrainable = rows.filter((row) => !isDrainableKind(row.kind));

  if (matchRow) {
    let payload: MatchCreate;
    try {
      payload = toMatchCreate(Match.fromJSON(matchRow.payload));
    } catch (cause) {
      await park(rows, unmappable(cause), sweep);
      return false;
    }
    const { error, response } = await createMatch({ body: payload });
    const verdict = classify(response);
    switch (verdict.kind) {
      case "transient":
        noteTransient(sweep, response);
        return false;
      case "unauthorized":
        sweep.unauthorized = true;
        return true;
      case "gone":
        // A match that cannot be created has nothing for its points to attach
        // to, so the whole group goes, not just the create.
        await discard(rows, sweep);
        return false;
      case "refused":
        await park(rows, refusal(verdict.response, error), sweep);
        return false;
      case "ok":
        await acknowledge([matchRow], sweep);
    }
  }

  let start = 0;
  while (start < pointRows.length) {
    let batch: Batch;
    try {
      batch = mapBatch(pointRows, start);
    } catch (cause) {
      await park(pointRows.slice(start), unmappable(cause), sweep);
      return false;
    }
    const { error, response } = await ingestPoints({
      path: { match_id: first.matchId },
      body: { device_id: deviceId, points: batch.points },
    });
    const verdict = classify(response);
    switch (verdict.kind) {
      case "transient":
        noteTransient(sweep, response);
        return false;
      case "unauthorized":
        sweep.unauthorized = true;
        return true;
      case "gone":
        // The match was deleted, which every row behind this batch would hit
        // too, so they are discarded on the same grouping as a park.
        await discard(pointRows.slice(start), sweep);
        return false;
      case "refused":
        // The batch is refused whole, and the refusal is durable state the
        // rest of this match's rows would hit too, so they park together.
        await park(pointRows.slice(start), refusal(verdict.response, error), sweep);
        return false;
      case "ok":
        await acknowledge(pointRows.slice(start, batch.end), sweep);
    }
    start = batch.end;
  }

  if (outcomeRow && undrainable.length === 0) {
    const halt = await flushOutcome(outcomeRow, first.matchId, sweep);
    if (halt) return true;
  }
  return false;
}

/**
 * Sends the match's outcome row, the PATCH that records who won and how. Runs last for
 * its match: it is what completes the match server-side, and a completed match refuses
 * further points. Answers true only for a 401.
 */
async function flushOutcome(row: OutboxRow, matchId: string, sweep: Sweep): Promise<boolean> {
  let payload: MatchUpdate;
  try {
    payload = toMatchOutcomeUpdate(row.payload);
  } catch (cause) {
    await park([row], unmappable(cause), sweep);
    return false;
  }
  const { error, response } = await updateMatch({ path: { match_id: matchId }, body: payload });
  const verdict = classify(response);
  switch (verdict.kind) {
    case "transient":
      noteTransient(sweep, response);
      return false;
    case "unauthorized":
      sweep.unauthorized = true;
      return true;
    case "gone":
      await discard([row], sweep);
      return false;
    case "refused":
      await park([row], refusal(verdict.response, error), sweep);
      return false;
    case "ok":
      await acknowledge([row], sweep);
      return false;
  }
}

interface Batch {
  points: PointCreate[];
  /** Index one past the last row in the batch. */
  end: number;
}

const encoder = new TextEncoder();

/**
 * The rows from `start` that fit one request: whichever of the count ceiling and
 * the byte budget it reaches first. A single point over the budget still goes on
 * its own, since there is nothing left to split it into.
 */
function mapBatch(rows: readonly OutboxRow[], start: number): Batch {
  const points: PointCreate[] = [];
  let bytes = 0;
  let end = start;
  while (end < rows.length && points.length < MAX_POINTS_PER_BATCH) {
    const point = toPointCreate(Point.fromJSON(rows[end]!.payload));
    // Encoded, not `.length`: a note is free text, and outside ASCII a character
    // is more than one byte, which is what the server's limit counts.
    const size = encoder.encode(JSON.stringify(point)).length + 1;
    if (points.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
    points.push(point);
    bytes += size;
    end += 1;
  }
  return { points, end };
}

type Verdict =
  { kind: "ok" | "transient" | "unauthorized" | "gone" } | { kind: "refused"; response: Response };

/**
 * No response means fetch itself threw: a network failure. 429 sits with the
 * 5xx bucket because the rate limiter's refusal clears by itself, where the
 * ingest 4xxs conflict with durable state no amount of waiting changes. Of
 * those, only 410 discards: it is our API's tombstone for a match the coach
 * deleted, and nothing else in this stack sends one (#214).
 */
function classify(response: Response | undefined): Verdict {
  if (response === undefined) return { kind: "transient" };
  if (response.status === 401) return { kind: "unauthorized" };
  if (response.status === 410) return { kind: "gone" };
  if (response.status === 429 || response.status >= 500) return { kind: "transient" };
  return response.ok ? { kind: "ok" } : { kind: "refused", response };
}

async function acknowledge(rows: readonly OutboxRow[], sweep: Sweep): Promise<void> {
  await remove(rows.map((row) => row.id));
  sweep.acknowledged += rows.length;
}

/**
 * Removes rows unsent because the coach deleted the match they belong to, on
 * this device or another. Not parked, because a failed count would ask them to
 * act on their own decision. Every other row that can never land does park, so
 * one they did not choose to lose stays visible (#214).
 */
async function discard(rows: readonly OutboxRow[], sweep: Sweep): Promise<void> {
  await remove(rows.map((row) => row.id));
  sweep.discarded += rows.length;
}

async function park(
  rows: readonly OutboxRow[],
  failure: OutboxFailure,
  sweep: Sweep,
): Promise<void> {
  await markFailed(
    rows.map((row) => row.id),
    failure,
  );
  sweep.parked += rows.length;
}

function noteTransient(sweep: Sweep, response: Response | undefined): void {
  sweep.transient = true;
  const retryAfter = getRetryAfterSeconds(response);
  if (retryAfter !== null) {
    sweep.retryAfterSeconds = Math.max(sweep.retryAfterSeconds ?? 0, retryAfter);
  }
}

function refusal(
  response: Response,
  error: ErrorDetail | HttpValidationError | Error | undefined,
): OutboxFailure {
  return {
    status: response.status,
    message: parseErrorMessage(error, "The server refused this batch."),
  };
}

/** A payload this app version cannot turn into a request; permanent for it. */
function unmappable(cause: unknown): OutboxFailure {
  return {
    status: null,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
