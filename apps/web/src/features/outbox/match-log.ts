/**
 * The match log — every event of every match still on this device.
 *
 * The outbox next door is a message queue whose rows are deleted once they land.
 * That makes it a poor place to keep the match itself: a coach whose phone died
 * mid-match would find the points already synced were gone from the queue and so
 * gone from the score. This table is state instead, written on every commit and
 * every undo, and read back at start-up to fold the score again (#119).
 *
 * Same durability rules as the outbox by construction: it lives in the same
 * database, so `purgeLocalData`'s delete of that database takes the log with it.
 *
 * Every function here is fire-and-forget from capture's point of view — the tap
 * handler writes and moves on, exactly as it does for `outbox.append`, because the
 * capture path may never await I/O (see `.claude/rules/web-capture.md`).
 */

import { liveQuery, type Observable } from "dexie";

import { outboxDb } from "./db";
import type { LoggedEvent, LoggedMatch } from "./db";

export type { LoggedEvent, LoggedMatch } from "./db";

/**
 * Records one event. Overwrites by id rather than refusing, unlike the outbox's
 * first-write-wins: the log holds the current truth about a match, and rewriting an
 * event under its own id can only ever be the same event written twice.
 */
export async function appendEvent(event: LoggedEvent): Promise<void> {
  await outboxDb.events.put(event);
}

/** Drops one event — undo's half of the tail-only edit. */
export async function removeEvent(id: string): Promise<void> {
  await outboxDb.events.delete(id);
}

/** One match's events, oldest first, which is the order the fold needs them in. */
export async function readLog(matchId: string): Promise<LoggedEvent[]> {
  return outboxDb.events.where({ matchId }).sortBy("sequence");
}

/** Records the match and the two facts its events can't carry. */
export async function saveMatch(match: LoggedMatch): Promise<void> {
  await outboxDb.matches.put(match);
}

export async function readMatch(matchId: string): Promise<LoggedMatch | undefined> {
  return outboxDb.matches.get(matchId);
}

/**
 * The coach's unfinished matches, most recently touched first — what the in-progress
 * banner needs, and what a resumed capture screen looks itself up in.
 */
export async function listInProgress(coachId: string): Promise<LoggedMatch[]> {
  const rows = await outboxDb.matches.where({ coachId }).toArray();
  return rows
    .filter((row) => !row.finished)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * `listInProgress` above, re-emitted whenever the log changes, so the in-progress
 * banner (#251) needs no polling and no server round trip — capture is offline-first,
 * and a server-driven banner would be dark exactly when it's needed, at the court.
 * `saveMatch` writes on every committed point (`live-match.tsx`'s `queueEvent`), which
 * is what keeps a live score in the banner moving rather than stalling on the moment
 * capture started.
 */
export function watchInProgress(coachId: string): Observable<LoggedMatch[]> {
  return liveQuery(() => listInProgress(coachId));
}

/** The one unfinished match for this player, if capture left one behind. */
export async function findInProgressFor(
  coachId: string,
  trackedPlayerId: string,
): Promise<LoggedMatch | undefined> {
  const rows = await outboxDb.matches.where({ coachId, trackedPlayerId }).toArray();
  return rows
    .filter((row) => !row.finished)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

/**
 * `findInProgressFor` above, re-emitted whenever the log changes — the single-writer
 * claim (#197) needs the current match id the moment capture starts or resumes one,
 * with no prop out of `LiveMatch` (which exposes none): this fires from the same
 * `saveMatch` write `LiveMatch` itself reads back on the next render.
 */
export function watchInProgressFor(
  coachId: string,
  trackedPlayerId: string,
): Observable<LoggedMatch | undefined> {
  return liveQuery(() => findInProgressFor(coachId, trackedPlayerId));
}

/** Forgets a match and everything logged for it — used when a match is deleted. */
export async function removeMatch(matchId: string): Promise<void> {
  await outboxDb.transaction("rw", outboxDb.matches, outboxDb.events, async () => {
    await outboxDb.matches.delete(matchId);
    await outboxDb.events.where({ matchId }).delete();
  });
}

/**
 * Forgets every match logged for one player of this coach's, finished or not, and
 * answers which match ids it removed. Deleting a player deletes their matches
 * server-side too (#243); left behind here, a still-open one pins the in-progress
 * banner on an id `NewMatch` can never resolve again (the player is gone), and a
 * finished one would just sit as dead rows. The caller still owes `removeByMatch` on
 * each returned id (`features/outbox/outbox.ts`) — the same two-step `delete-match-
 * sheet.tsx` already does for #214, so a queued row can't survive to repost the match.
 */
export async function removeForPlayer(coachId: string, trackedPlayerId: string): Promise<string[]> {
  return outboxDb.transaction("rw", outboxDb.matches, outboxDb.events, async () => {
    const rows = await outboxDb.matches.where({ coachId, trackedPlayerId }).toArray();
    const matchIds = rows.map((row) => row.matchId);
    if (matchIds.length === 0) return matchIds;
    await outboxDb.matches.bulkDelete(matchIds);
    await outboxDb.events.where("matchId").anyOf(matchIds).delete();
    return matchIds;
  });
}
