/**
 * The engine that empties the outbox into the API. Pure engine: when to run it
 * is flush-triggers.ts's job.
 *
 * One entry point, drainOutbox. It takes a web lock so two tabs never
 * double-flush, then sweeps the queue: rows grouped by match, the match create
 * first, then its points and its score checkpoints in enqueue order, each in
 * batches bounded by the spec's ceiling and by the body limit, then its point/
 * checkpoint deletes one at a time, then the outcome PATCH last. The outcome
 * goes last because ingest_points (and the checkpoint/delete endpoints beside
 * it) answer 409 for a match whose result is already set, so a PATCH sent first
 * would park everything behind it. Every server answer lands in one of five
 * buckets: success removes the rows; a 401 halts the whole run with the queue
 * intact, because a revoked session must never cost a match; a 410 means the
 * match those rows belong to was deliberately deleted, so they are discarded
 * rather than parked, and this device's log of it goes with them; any other
 * 4xx, a 404 included, is a permanent refusal, so the rows park as failed with
 * the reason recorded; network errors, 5xx and 429 are transient, so the sweep
 * runs again on a doubling backoff until the schedule runs out. All the
 * requests here are idempotent server-side, which is what makes re-sending
 * after a lost acknowledgement safe.
 */

import {
  createMatch,
  deletePoint,
  deleteScoreCheckpoint,
  ingestPoints,
  ingestScoreCheckpoints,
  updateMatch,
  type ErrorDetail,
  type HttpValidationError,
  type MatchCreate,
  type MatchUpdate,
  type PointCreate,
  type ScoreCheckpointCreate,
} from "@matchpoint/api-client";

import { ScoreCheckpoint } from "@/features/capture/checkpoint";
import { Match } from "@/features/capture/match";
import { Point } from "@/features/capture/point";
import type { OutboxFailure, OutboxRow } from "@/features/outbox/db";
import { readMatch, removeMatch } from "@/features/outbox/match-log";
import { markFailed, readByMatch, readPending, remove } from "@/features/outbox/outbox";
import { getRetryAfterSeconds, parseErrorMessage } from "@/lib/parse-error";

import { toScoreCheckpointCreate } from "./checkpoint-payload";
import { toEventDeleteTarget, type EventDeleteTarget } from "./event-delete-payload";
import { toMatchOutcomeUpdate } from "./match-outcome-payload";
import { toMatchCreate } from "./match-payload";
import { toPointCreate } from "./point-payload";

/**
 * The spec's maxItems on PointBatch.points. drain.test.ts parses every body
 * with zPointBatch, so drift from the real bound fails there, not live.
 */
export const MAX_POINTS_PER_BATCH = 500;

/**
 * The spec's maxItems on ScoreCheckpointBatch.checkpoints — the same ceiling as
 * points, but its own name since it documents a different schema field.
 */
export const MAX_CHECKPOINTS_PER_BATCH = 500;

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
 * points and checkpoints in chunks, then its event deletes one at a time, then the
 * outcome last.
 *
 * The outcome goes last because ingest_points, ingest_score_checkpoints and the delete
 * endpoints all refuse a match whose `result` is already set. Sending the PATCH first
 * would complete the match and then park everything behind it as permanently failed.
 * For the same reason it is skipped whenever anything earlier in this match did not
 * land: every non-"ok" branch in the match/point/checkpoint sections returns before
 * reaching it. Deletes are the one exception, since each targets an independent id and
 * a refusal on one says nothing about the next — that loop keeps going, but still
 * tracks whether anything in it failed and holds the outcome back if so.
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
  const checkpointRows = rows.filter((row) => row.kind === "checkpoint");
  const eventDeleteRows = rows.filter((row) => row.kind === "eventDelete");
  const outcomeRow = rows.find((row) => row.kind === "matchOutcome");

  let match: Match | undefined;

  if (matchRow) {
    let payload: MatchCreate;
    try {
      match = Match.fromJSON(matchRow.payload);
      payload = toMatchCreate(match);
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
        await discard(rows, first.matchId, sweep);
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
    let batch: Batch<PointCreate>;
    try {
      batch = mapBatch(pointRows, start, MAX_POINTS_PER_BATCH, (payload) =>
        toPointCreate(Point.fromJSON(payload)),
      );
    } catch (cause) {
      await park(pointRows.slice(start), unmappable(cause), sweep);
      return false;
    }
    const { error, response } = await ingestPoints({
      path: { match_id: first.matchId },
      body: { device_id: deviceId, points: batch.items },
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
        // The match was deleted, so every remaining row of its own goes with the
        // points rather than waiting for a sweep of their own: this discard removes
        // the match log a checkpoint is mapped against, and a later sweep could then
        // only park it for a deletion the coach chose.
        await discard(
          [
            ...pointRows.slice(start),
            ...checkpointRows,
            ...eventDeleteRows,
            ...(outcomeRow ? [outcomeRow] : []),
          ],
          first.matchId,
          sweep,
        );
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

  if (checkpointRows.length > 0 && match === undefined) {
    // The match create already landed in an earlier sweep, so it's off this
    // match's rows — the log is where the current Match still lives.
    const logged = await readMatch(first.matchId);
    if (logged === undefined) {
      // Not the same failure as a bad payload: the checkpoint itself is fine,
      // its match's local record is just gone (a race with a match/player
      // delete elsewhere on this device). Parks rather than discards, since
      // this isn't a choice the coach made — see discard()'s own reasoning.
      await park(checkpointRows, matchLogMissing(), sweep);
      return false;
    }
    match = Match.fromJSON(logged.payload);
  }

  let checkpointStart = 0;
  while (match !== undefined && checkpointStart < checkpointRows.length) {
    const currentMatch = match;
    let batch: Batch<ScoreCheckpointCreate>;
    try {
      batch = mapBatch(checkpointRows, checkpointStart, MAX_CHECKPOINTS_PER_BATCH, (payload) =>
        toScoreCheckpointCreate(currentMatch, ScoreCheckpoint.fromJSON(payload)),
      );
    } catch (cause) {
      await park(checkpointRows.slice(checkpointStart), unmappable(cause), sweep);
      return false;
    }
    const { error, response } = await ingestScoreCheckpoints({
      path: { match_id: first.matchId },
      body: { device_id: deviceId, checkpoints: batch.items },
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
        await discard(checkpointRows.slice(checkpointStart), first.matchId, sweep);
        return false;
      case "refused":
        await park(checkpointRows.slice(checkpointStart), refusal(verdict.response, error), sweep);
        return false;
      case "ok":
        await acknowledge(checkpointRows.slice(checkpointStart, batch.end), sweep);
    }
    checkpointStart = batch.end;
  }

  // Each delete targets one independent id, unlike a point/checkpoint batch, so a
  // refusal on one row says nothing about the next: it parks alone and the loop
  // moves on, rather than halting the rest of this match the way a batch does. A
  // parked delete still has to hold the outcome back, though — completing the
  // match while one of its deletes is stuck would fence it out for good.
  let deleteFailed = false;
  for (const [index, row] of eventDeleteRows.entries()) {
    let target: EventDeleteTarget;
    try {
      target = toEventDeleteTarget(row);
    } catch (cause) {
      await park([row], unmappable(cause), sweep);
      deleteFailed = true;
      continue;
    }
    const { error, response } =
      target.kind === "point"
        ? await deletePoint({ path: { match_id: first.matchId, point_id: target.targetId } })
        : await deleteScoreCheckpoint({
            path: { match_id: first.matchId, checkpoint_id: target.targetId },
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
        // The match was deleted, which every delete behind this one would hit
        // too, so they discard together rather than one 410 at a time.
        await discard(eventDeleteRows.slice(index), first.matchId, sweep);
        return false;
      case "refused":
        await park([row], refusal(verdict.response, error), sweep);
        deleteFailed = true;
        continue;
      case "ok":
        await acknowledge([row], sweep);
    }
  }

  if (outcomeRow && !deleteFailed) {
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
      await discard([row], matchId, sweep);
      return false;
    case "refused":
      await park([row], refusal(verdict.response, error), sweep);
      return false;
    case "ok":
      await acknowledge([row], sweep);
      return false;
  }
}

interface Batch<T> {
  items: T[];
  /** Index one past the last row in the batch. */
  end: number;
}

const encoder = new TextEncoder();

/**
 * The rows from `start` that fit one request: whichever of the count ceiling and
 * the byte budget it reaches first. A single item over the budget still goes on its
 * own, since there is nothing left to split it into. Shared between points and score
 * checkpoints — the two request bodies the API batches under the same contract.
 */
function mapBatch<T>(
  rows: readonly OutboxRow[],
  start: number,
  maxItems: number,
  toItem: (payload: unknown) => T,
): Batch<T> {
  const items: T[] = [];
  let bytes = 0;
  let end = start;
  while (end < rows.length && items.length < maxItems) {
    const item = toItem(rows[end]!.payload);
    // Encoded, not `.length`: a note is free text, and outside ASCII a character
    // is more than one byte, which is what the server's limit counts.
    const size = encoder.encode(JSON.stringify(item)).length + 1;
    if (items.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
    items.push(item);
    bytes += size;
    end += 1;
  }
  return { items, end };
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
 * Removes rows unsent because the coach deleted the match they belong to, on this
 * device or another, and this device's log of that match with them: left behind, the
 * log would have capture resume into a match that no longer exists. Not parked,
 * because a failed count would ask them to act on their own decision, while every
 * other row that can never land does park, so one they did not choose to lose stays
 * visible (#214).
 */
async function discard(rows: readonly OutboxRow[], matchId: string, sweep: Sweep): Promise<void> {
  await remove(rows.map((row) => row.id));
  await removeMatch(matchId);
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

/** A checkpoint whose match dropped out of the local log — not a bad payload. */
function matchLogMissing(): OutboxFailure {
  return {
    status: null,
    message: "This match's local record is missing, so its checkpoints cannot be mapped.",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
