import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { outboxDb, type OutboxEntry } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { getDeviceId } from "@/lib/device-id";
import { recordOwnerIfUnknown } from "@/lib/local-data";

import { drainOutbox } from "./drain";
import {
  APPEND_RETRY_DELAYS_MS,
  DRAIN_DEBOUNCE_MS,
  registerFlushTriggers,
  retryLostAppend,
} from "./flush-triggers";

// The engine has its own suite; these tests are about when it gets called.
// isDatabaseClosed stays real; retryLostAppend's whole job hangs off it.
vi.mock(import("./drain"), async (importOriginal) => ({
  ...(await importOriginal()),
  drainOutbox: vi.fn(async () => ({
    acknowledged: 0,
    discarded: 0,
    parked: 0,
    unauthorized: false,
    skipped: false,
  })),
}));

// Spies with real implementations passing through, so the give-up test can
// make append keep failing without unplugging the queue everywhere else.
vi.mock(import("@/features/outbox/outbox"), { spy: true });

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-00000000000a";

function entry(id: string): OutboxEntry {
  return { id, coachId: COACH_ID, matchId: MATCH_ID, kind: "point", payload: { id } };
}

const cleanups: (() => void)[] = [];

function register(): void {
  cleanups.push(registerFlushTriggers());
}

/** Lets Dexie's and fake-indexeddb's macrotask work run under fake timers. */
async function ticks(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Runs the debounce window down and lets whatever it fired finish. */
async function debounceElapses(): Promise<void> {
  await ticks();
  await vi.advanceTimersByTimeAsync(DRAIN_DEBOUNCE_MS);
  await ticks();
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setOnLine(onLine: boolean): void {
  Object.defineProperty(navigator, "onLine", { value: onLine, configurable: true });
}

beforeEach(async () => {
  localStorage.clear();
  await outboxDb.delete();
  await outboxDb.open();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(navigator, "onLine");
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("registerFlushTriggers", () => {
  test("drains at launch, for the recorded owner as this device", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();

    await debounceElapses();

    expect(drainOutbox).toHaveBeenCalledExactlyOnceWith(COACH_ID, getDeviceId());
  });

  test("never drains while the device has no recorded owner", async () => {
    register();

    await debounceElapses();
    window.dispatchEvent(new Event("online"));
    await debounceElapses();

    // Nothing on this device belongs to anyone yet, so there is nothing a
    // drain could send; the next trigger re-reads the record and catches a
    // sign-in that has happened in the meantime.
    expect(drainOutbox).not.toHaveBeenCalled();
  });

  test("drains when connectivity returns", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();
    await debounceElapses();
    vi.clearAllMocks();

    window.dispatchEvent(new Event("online"));
    await debounceElapses();

    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  test("drains when the app becomes visible, not when it hides", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();
    await debounceElapses();
    vi.clearAllMocks();

    setVisibility("hidden");
    await debounceElapses();
    expect(drainOutbox).not.toHaveBeenCalled();

    setVisibility("visible");
    await debounceElapses();
    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  test("a queue write while online nudges a drain", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();
    await debounceElapses();
    vi.clearAllMocks();

    await append(entry("nudged"));
    await debounceElapses();

    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  test("a queue write while offline waits for the online event", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    setOnLine(false);
    register();
    await debounceElapses();
    vi.clearAllMocks();

    await append(entry("held-back"));
    await debounceElapses();
    // Mid-capture this fires on every point; offline it would only burn the
    // engine's backoff schedule, so the nudge alone stays quiet.
    expect(drainOutbox).not.toHaveBeenCalled();

    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    await debounceElapses();
    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  test("a burst of triggers coalesces into one drain", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();

    window.dispatchEvent(new Event("online"));
    setVisibility("visible");
    window.dispatchEvent(new Event("online"));
    await debounceElapses();

    expect(drainOutbox).toHaveBeenCalledTimes(1);
  });

  test("re-arms after a drain that found the lock held", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    vi.mocked(drainOutbox).mockResolvedValueOnce({
      acknowledged: 0,
      discarded: 0,
      parked: 0,
      unauthorized: false,
      skipped: true,
    });
    register();

    await debounceElapses();
    expect(drainOutbox).toHaveBeenCalledTimes(1);

    // The run that held the lock writes nothing this one can be nudged by, so
    // without the re-arm these rows wait for a visibility change or a relaunch.
    await debounceElapses();
    expect(drainOutbox).toHaveBeenCalledTimes(2);

    await debounceElapses();
    expect(drainOutbox).toHaveBeenCalledTimes(2);
  });

  test("unregistering removes every trigger, the pending debounce included", async () => {
    recordOwnerIfUnknown(COACH_ID, "coach");
    register();

    cleanups.splice(0)[0]!();
    window.dispatchEvent(new Event("online"));
    await append(entry("after-unregister"));
    await debounceElapses();

    expect(drainOutbox).not.toHaveBeenCalled();
  });
});

describe("retryLostAppend", () => {
  test("re-appends an entry lost to a closed database", async () => {
    retryLostAppend({
      reason: "write_failed",
      cause: { name: "DatabaseClosedError" },
      entry: entry("lost"),
    });

    await vi.advanceTimersByTimeAsync(APPEND_RETRY_DELAYS_MS[0]!);
    await ticks();

    expect((await readPending(COACH_ID)).map((row) => row.id)).toEqual(["lost"]);
  });

  test("leaves other write failures alone", async () => {
    retryLostAppend({
      reason: "quota_exceeded",
      cause: new DOMException("out of space", "QuotaExceededError"),
      entry: entry("not-ours"),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await ticks();

    // A full disk does not heal on the next operation; retrying it here would
    // only re-fire the failure listeners the coach is already being shown by.
    expect(append).not.toHaveBeenCalled();
  });

  test("gives up once the schedule runs out", async () => {
    const failure = {
      reason: "write_failed" as const,
      cause: { name: "DatabaseClosedError" },
      entry: entry("stubborn"),
    };
    vi.mocked(append).mockResolvedValue({ ok: false, ...failure });

    retryLostAppend(failure);
    for (const delay of APPEND_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
      await ticks();
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await ticks();

    expect(append).toHaveBeenCalledTimes(APPEND_RETRY_DELAYS_MS.length);
  });

  test("a repeat failure for an entry already mid-retry starts no second chain", async () => {
    const failure = {
      reason: "write_failed" as const,
      cause: { name: "DatabaseClosedError" },
      entry: entry("doubled"),
    };
    vi.mocked(append).mockResolvedValue({ ok: false, ...failure });

    retryLostAppend(failure);
    retryLostAppend(failure);
    for (const delay of APPEND_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delay);
      await ticks();
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await ticks();

    expect(append).toHaveBeenCalledTimes(APPEND_RETRY_DELAYS_MS.length);
  });
});
