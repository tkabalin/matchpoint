import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { outboxDb, OUTBOX_PAYLOAD_VERSION, type OutboxEntry, type OutboxFailure } from "./db";
import {
  append,
  countUnsynced,
  deleteOutboxDatabase,
  hasQueuedCreate,
  markFailed,
  onAppendFailure,
  readByMatch,
  readPending,
  remove,
  removeByMatch,
  retryFailed,
  watchCounts,
  watchQueuedCreate,
  type AppendFailure,
  type AppendResult,
  type OutboxCounts,
} from "./outbox";

/** A refusal like the ones the drain records; the tests only need some reason. */
const PARKED: OutboxFailure = { status: 409, message: "The match is completed." };

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const OTHER_COACH_ID = "c0ac0000-0000-4000-8000-000000000002";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OTHER_MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000002";

function pointEntry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id,
    coachId: COACH_ID,
    matchId: MATCH_ID,
    kind: "point",
    payload: { id, gameId: "g1" },
    ...overrides,
  };
}

/** Narrows a successful append to its enqueue order, so tests can compare them. */
function seqOf(result: AppendResult): number {
  if (!result.ok) throw new Error(`unexpected append failure: ${result.reason}`);
  return result.seq;
}

/** Narrows a failed append, so tests can read its reason and the lost entry. */
function failureOf(result: AppendResult): AppendFailure {
  if (result.ok) throw new Error("expected the append to fail");
  return result;
}

// Deleting and reopening rather than clearing the table: a cleared table keeps
// IndexedDB's key generator where it was, and several tests below assert on the
// `seq` values a fresh queue hands out.
beforeEach(async () => {
  await outboxDb.delete();
  await outboxDb.open();
});

// Connections opened by a `vi.resetModules()` re-import. Closing them stops them
// accumulating across the file; the `beforeEach` above copes either way, since
// Dexie's delete asks any other connection to close first.
const reimportedDbs: { close: () => unknown }[] = [];

// Teardown, not an inline restore at the end of each test: a failed assertion
// would otherwise leave a mocked table, a stubbed navigator, or an open
// connection in place for every test after it.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of reimportedDbs.splice(0)) db.close();
});

test("stamps the payload version rows are written with", () => {
  // Asserted against the literal, not the import: a bump has to be deliberate,
  // because rows already queued on a coach's device carry the old number.
  expect(OUTBOX_PAYLOAD_VERSION).toBe(1);
});

describe("append", () => {
  test("stores the entry as pending, stamped with the payload version", async () => {
    const entry = pointEntry("p1");

    const result = await append(entry);

    const [row] = await readPending(COACH_ID);
    expect(row).toEqual({
      ...entry,
      seq: seqOf(result),
      status: "pending",
      schemaVersion: OUTBOX_PAYLOAD_VERSION,
    });
  });

  test("keeps the payload opaque — it is stored, not inspected", async () => {
    // A shape neither Point nor Match would ever produce: this layer must not
    // know or care what the capture field list turns out to be.
    const payload = { anything: [1, { nested: true }], atAll: null };

    await append(pointEntry("p1", { payload }));

    const [row] = await readPending(COACH_ID);
    expect(row!.payload).toEqual(payload);
  });

  test("hands out increasing enqueue order in call order", async () => {
    const first = seqOf(await append(pointEntry("p1")));
    const second = seqOf(await append(pointEntry("p2")));

    expect(second).toBeGreaterThan(first);
  });

  test("keeps enqueue order increasing after earlier rows are drained", async () => {
    const drained = seqOf(await append(pointEntry("p1")));
    await remove(["p1"]);

    const next = seqOf(await append(pointEntry("p2")));

    // The bug this guards: a counter derived from the rows still present would
    // restart low, so a new point would sort ahead of ones already queued.
    expect(next).toBeGreaterThan(drained);
  });

  test("keeps the first payload for an id already queued", async () => {
    const first = await append(pointEntry("p1", { payload: { v: 1 } }));

    const again = await append(pointEntry("p1", { payload: { v: 2 } }));

    // First write wins. The drain acknowledges by id, so a row rewritten between
    // its send and its ack would be removed carrying a payload never sent.
    expect(again).toEqual(first);
    const rows = await readPending(COACH_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ v: 1 });
  });

  test("leaves a parked row parked when its entity is appended again", async () => {
    await append(pointEntry("p1"));
    await markFailed(["p1"], PARKED);

    await append(pointEntry("p1"));

    // Reviving only this row would hand the drain a match whose points are still
    // parked; `retryFailed` is the one way back, and it moves them together.
    expect(await readPending(COACH_ID)).toEqual([]);
  });

  test("survives concurrent appends of the same id", async () => {
    const entry = pointEntry("p1");

    // A tap fires append without awaiting it, so two appends of one entity can
    // be in flight at once. The read-then-write is inside one `rw` transaction,
    // and IndexedDB serializes those, so neither call can trip the unique index.
    const results = await Promise.all([append(entry), append({ ...entry, payload: { v: 2 } })]);

    expect(results.map((result) => (result.ok ? "ok" : result.reason))).toEqual(["ok", "ok"]);
    expect(await readPending(COACH_ID)).toHaveLength(1);
  });
});

describe("append failures", () => {
  const unsubscribes: (() => void)[] = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  });

  function collectFailures(): AppendFailure[] {
    const failures: AppendFailure[] = [];
    unsubscribes.push(onAppendFailure((failure) => failures.push(failure)));
    return failures;
  }

  test("surfaces a quota error as a typed failure instead of rejecting", async () => {
    vi.spyOn(outboxDb.entries, "add").mockRejectedValue(
      new DOMException("out of space", "QuotaExceededError"),
    );
    const failures = collectFailures();

    const failure = failureOf(await append(pointEntry("p1")));

    expect(failure.reason).toBe("quota_exceeded");
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe("quota_exceeded");
    // The lost entry comes with it, so a listener can name the point.
    expect(failures[0]!.entry).toEqual(pointEntry("p1"));
  });

  test("finds a quota error Dexie has wrapped in an aborted transaction", async () => {
    // A write that runs out of space inside a `rw` transaction reaches the caller
    // as Dexie's own abort error, with the browser's DOMException on `inner`.
    vi.spyOn(outboxDb.entries, "add").mockRejectedValue(
      Object.assign(new Error("transaction aborted"), {
        name: "AbortError",
        inner: new DOMException("out of space", "QuotaExceededError"),
      }),
    );

    expect(failureOf(await append(pointEntry("p1"))).reason).toBe("quota_exceeded");
  });

  test("distinguishes any other write failure from a quota one", async () => {
    vi.spyOn(outboxDb.entries, "add").mockRejectedValue(new Error("disk on fire"));

    expect(failureOf(await append(pointEntry("p1"))).reason).toBe("write_failed");
  });

  test("reports a payload the browser cannot clone as a write failure", async () => {
    // The mistake a caller will actually make: handing over the live Point or
    // Match instead of its `toJSON()` output. It must not reject at the tap.
    const failure = failureOf(await append(pointEntry("p1", { payload: { fn: () => 1 } })));

    expect(failure.reason).toBe("write_failed");
  });

  test("keeps its promise to the tap when a listener throws", async () => {
    vi.spyOn(outboxDb.entries, "add").mockRejectedValue(new Error("disk on fire"));
    unsubscribes.push(
      onAppendFailure(() => {
        throw new Error("listener bug");
      }),
    );
    const failures = collectFailures();

    const failure = failureOf(await append(pointEntry("p1")));

    // The throwing listener is notified first, so this also proves it didn't
    // cost the next listener its notification.
    expect(failure.reason).toBe("write_failed");
    expect(failures).toHaveLength(1);
  });

  test("stops notifying a listener that has unsubscribed", async () => {
    vi.spyOn(outboxDb.entries, "add").mockRejectedValue(new Error("disk on fire"));
    const listener = vi.fn();
    onAppendFailure(listener)();

    await append(pointEntry("p1"));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("readPending", () => {
  // Ids descend lexically while enqueue order ascends, so an id-ordered result
  // fails these. Real ids are UUIDs, and the two orders have nothing to do with
  // each other; fixtures that happened to agree would pin only "not reversed".
  test("returns only this coach's pending rows, oldest first", async () => {
    await append(pointEntry("zz-first"));
    await append(pointEntry("yy-parked"));
    await append(pointEntry("xx-other-coach", { coachId: OTHER_COACH_ID }));
    await append(pointEntry("aa-last"));
    await markFailed(["yy-parked"], PARKED);

    const rows = await readPending(COACH_ID);

    expect(rows.map((row) => row.id)).toEqual(["zz-first", "aa-last"]);
  });

  test("is empty for a coach with nothing queued", async () => {
    await append(pointEntry("p1"));

    expect(await readPending(OTHER_COACH_ID)).toEqual([]);
  });
});

describe("readByMatch", () => {
  // Ids descend lexically against enqueue order here too — see readPending above.
  test("returns one match's rows in enqueue order, failed ones included", async () => {
    await append(pointEntry("zz-match", { kind: "match" }));
    await append(pointEntry("mm-parked"));
    await append(pointEntry("bb-other-match", { matchId: OTHER_MATCH_ID }));
    await append(pointEntry("aa-last"));
    await markFailed(["mm-parked"], PARKED);

    const rows = await readByMatch(MATCH_ID);

    expect(rows.map((row) => row.id)).toEqual(["zz-match", "mm-parked", "aa-last"]);
  });
});

describe("hasQueuedCreate", () => {
  test("is true while the match's own create row is pending", async () => {
    await append(pointEntry("m1", { kind: "match" }));

    expect(await hasQueuedCreate(MATCH_ID)).toBe(true);
  });

  test("is still true once the create row is parked", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await markFailed(["m1"], PARKED);

    // The server doesn't know the match exists either way — pending or parked. A
    // claim attempted against either would land on an id it has never seen.
    expect(await hasQueuedCreate(MATCH_ID)).toBe(true);
  });

  test("is false once the create row is drained", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await remove(["m1"]);

    expect(await hasQueuedCreate(MATCH_ID)).toBe(false);
  });

  test("is false for a match with nothing queued at all", async () => {
    expect(await hasQueuedCreate(OTHER_MATCH_ID)).toBe(false);
  });

  test("a queued point with no matching create row doesn't count as one", async () => {
    await append(pointEntry("p1"));

    expect(await hasQueuedCreate(MATCH_ID)).toBe(false);
  });
});

describe("watchQueuedCreate", () => {
  const subscriptions: { unsubscribe: () => void }[] = [];

  afterEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
  });

  function watch(matchId: string): boolean[] {
    const seen: boolean[] = [];
    subscriptions.push(watchQueuedCreate(matchId).subscribe((queued) => seen.push(queued)));
    return seen;
  }

  test("flips to false the moment the drain acknowledges the create", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    const seen = watch(MATCH_ID);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(true));

    await remove(["m1"]);

    await vi.waitFor(() => expect(seen.at(-1)).toBe(false));
  });
});

describe("remove", () => {
  test("drops only the given ids", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));
    await append(pointEntry("p3"));

    await remove(["p1", "p3"]);

    expect((await readPending(COACH_ID)).map((row) => row.id)).toEqual(["p2"]);
  });

  test("ignores an id that is not queued", async () => {
    await append(pointEntry("p1"));

    await remove(["p9"]);

    expect(await readPending(COACH_ID)).toHaveLength(1);
  });

  test("drops nothing when given no ids", async () => {
    await append(pointEntry("p1"));

    // A drain cycle that acknowledged nothing calls this with an empty list. An
    // unfiltered rewrite of it would clear the whole unsynced queue.
    await remove([]);

    expect(await readPending(COACH_ID)).toHaveLength(1);
  });
});

describe("removeByMatch", () => {
  test("clears one match's rows, parked ones included, and counts them", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));
    await append(pointEntry("other", { matchId: OTHER_MATCH_ID }));
    await markFailed(["p2"], PARKED);

    const removed = await removeByMatch(MATCH_ID);

    // Parked rows go with the pending ones: a coach who has deleted the match
    // is never going to retry its refusals, and nothing else clears them.
    expect(removed).toBe(3);
    expect(await readByMatch(MATCH_ID)).toEqual([]);
    expect((await readByMatch(OTHER_MATCH_ID)).map((row) => row.id)).toEqual(["other"]);
  });

  test("answers zero for a match with nothing queued", async () => {
    await append(pointEntry("p1"));

    expect(await removeByMatch(OTHER_MATCH_ID)).toBe(0);
    expect(await readPending(COACH_ID)).toHaveLength(1);
  });
});

describe("markFailed", () => {
  test("parks a match and its dependent points in one call", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));

    await markFailed(["m1", "p1", "p2"], PARKED);

    expect(await readPending(COACH_ID)).toEqual([]);
    expect((await readByMatch(MATCH_ID)).map((row) => row.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
  });

  test("records why the rows were parked", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await append(pointEntry("p1"));

    await markFailed(["m1", "p1"], PARKED);

    // On the rows, not in drain memory: the reason has to survive a reload for
    // the sync status UI to say more than "failed: 2".
    expect((await readByMatch(MATCH_ID)).map((row) => row.failure)).toEqual([PARKED, PARKED]);
  });

  test("parks nothing when given no ids", async () => {
    await append(pointEntry("p1"));

    await markFailed([], PARKED);

    expect(await readPending(COACH_ID)).toHaveLength(1);
  });
});

describe("retryFailed", () => {
  test("returns this coach's failed rows to the queue and counts them", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));
    await append(pointEntry("p3", { coachId: OTHER_COACH_ID }));
    await markFailed(["p1", "p3"], PARKED);

    const retried = await retryFailed(COACH_ID);

    expect(retried).toBe(1);
    expect((await readPending(COACH_ID)).map((row) => row.id)).toEqual(["p1", "p2"]);
    expect(await readPending(OTHER_COACH_ID)).toEqual([]);
  });

  test("clears the recorded failure along with the status", async () => {
    await append(pointEntry("p1"));
    await markFailed(["p1"], PARKED);

    await retryFailed(COACH_ID);

    // A retried row carrying its old reason would read as a fresh refusal the
    // next time it is parked alongside rows that genuinely were.
    const [row] = await readPending(COACH_ID);
    expect(row!.failure).toBeUndefined();
    expect("failure" in row!).toBe(false);
  });
});

describe("deleteOutboxDatabase", () => {
  test("takes every coach's rows with it and leaves the queue writable", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("p2", { coachId: OTHER_COACH_ID }));

    await deleteOutboxDatabase();
    await append(pointEntry("p3"));

    // Writable afterwards because Dexie's default is to refuse to reopen a deleted
    // database, which would strand the next coach on the device with a dead queue.
    expect((await readPending(COACH_ID)).map((row) => row.id)).toEqual(["p3"]);
    expect(await readPending(OTHER_COACH_ID)).toEqual([]);
  });
});

describe("watchCounts", () => {
  const subscriptions: { unsubscribe: () => void }[] = [];

  // In teardown, not at the end of each test: a failing `waitFor` above would
  // otherwise leave the subscription live for the rest of the file.
  afterEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.unsubscribe();
  });

  function watch(coachId: string): OutboxCounts[] {
    const seen: OutboxCounts[] = [];
    subscriptions.push(watchCounts(coachId).subscribe((counts) => seen.push(counts)));
    return seen;
  }

  test("emits this coach's pending and failed counts as the queue changes", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));
    await append(pointEntry("p3", { coachId: OTHER_COACH_ID }));
    await markFailed(["p2"], PARKED);

    const seen = watch(COACH_ID);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 1, failed: 1 }));

    await append(pointEntry("p4"));
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 2, failed: 1 }));
  });

  test("leaves out kinds no drain can send", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("c1", { kind: "checkpoint" }));
    await append(pointEntry("d1", { kind: "eventDelete" }));

    const seen = watch(COACH_ID);

    // These have no endpoint yet, so counting them would show the coach unsynced
    // work that nothing they can do would ever clear.
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 1, failed: 0 }));
  });

  test("leaves them out of the failed count when a refused match parks them", async () => {
    await append(pointEntry("m1", { kind: "match" }));
    await append(pointEntry("c1", { kind: "checkpoint" }));
    await markFailed(["m1", "c1"], PARKED);

    const seen = watch(COACH_ID);

    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 0, failed: 1 }));
  });

  test("ignores writes belonging to another coach", async () => {
    const seen = watch(COACH_ID);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 0, failed: 0 }));

    await append(pointEntry("p1", { coachId: OTHER_COACH_ID }));
    await append(pointEntry("p2"));

    await vi.waitFor(() => expect(seen.at(-1)).toEqual({ pending: 1, failed: 0 }));
  });
});

describe("countUnsynced", () => {
  test("agrees with watchCounts' snapshot, without staying subscribed", async () => {
    await append(pointEntry("p1"));
    await append(pointEntry("p2"));
    await markFailed(["p2"], PARKED);

    await expect(countUnsynced(COACH_ID)).resolves.toEqual({ pending: 1, failed: 1 });
  });
});

describe("persistent storage", () => {
  /**
   * Re-imports the outbox, because "once" is once per session and the statically
   * imported one has already made its request in the tests above. Its database
   * connection is registered for the teardown that closes it.
   */
  async function freshOutbox() {
    vi.resetModules();
    reimportedDbs.push((await import("./db")).outboxDb);
    return await import("./outbox");
  }

  test("asks for eviction exemption once, on the first append", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { storage: { persist } });
    const outbox = await freshOutbox();

    await outbox.append(pointEntry("p1"));
    await outbox.append(pointEntry("p2"));

    expect(persist).toHaveBeenCalledTimes(1);
  });

  test("appends fine where the browser offers no storage manager", async () => {
    vi.stubGlobal("navigator", {});
    const outbox = await freshOutbox();

    const result = await outbox.append(pointEntry("p1"));

    expect(result.ok).toBe(true);
  });

  test("appends fine when the request is refused", async () => {
    vi.stubGlobal("navigator", { storage: { persist: () => Promise.reject(new Error("no")) } });
    const outbox = await freshOutbox();

    const result = await outbox.append(pointEntry("p1"));

    expect(result.ok).toBe(true);
  });

  test("appends fine when the storage manager throws instead of returning", async () => {
    // Not what the spec says `persist()` does, but `append` promising never to
    // reject means nothing on its path may throw, conforming or not.
    vi.stubGlobal("navigator", {
      storage: {
        persist: () => {
          throw new Error("not a promise");
        },
      },
    });
    const outbox = await freshOutbox();

    const result = await outbox.append(pointEntry("p1"));

    expect(result.ok).toBe(true);
  });
});
