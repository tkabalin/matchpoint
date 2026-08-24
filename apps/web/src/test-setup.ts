import { registerErrorStatusInterceptor } from "@matchpoint/api-client/error-interceptor";
import { cleanup, configure } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// jsdom implements no IndexedDB, so the outbox and the persisted query cache have
// nothing to open without this. Registered globally rather than per test file: Dexie
// and idb-keyval both read the global at open time, which happens on import.
import "fake-indexeddb/auto";
import { afterEach } from "vitest";

// Testing Library only registers its own auto-cleanup when Vitest's globals are on,
// and they are not. Without this, each test's render is left mounted in the same
// document, so the next one's queries match the previous test's output.
afterEach(cleanup);

// `testTimeout` in vite.config.ts bounds a whole test, but findBy*/waitFor keep their
// own budget, which defaults to 1s. A screen that fetches its own data still waits
// inside one of those, so these get the slack that timeout's 15s already assumes.
// Raising it again is no answer to a starved runner: see docs/testing.md.
configure({ asyncUtilTimeout: 5_000 });

// Mirrors main.tsx: without this, a test asserting on a thrown error's `.status`
// (see error-interceptor.ts) would run against an unregistered interceptor.
registerErrorStatusInterceptor();

// jsdom implements no layout, so it has no ResizeObserver — input-otp (shadcn's
// InputOTP, #148) uses one internally to size itself, and every test rendering it
// throws "ResizeObserver is not defined" without this.
//
// It reports a size rather than being a no-op, because recharts' ResponsiveContainer
// keeps its `initialDimension` only while ResizeObserver is *undefined*. With a no-op
// stub it instead measured jsdom's 0×0 and rendered null, so no chart in the suite drew
// anything at all — axes, ticks, lines and tooltips were silently absent.
const OBSERVED_SIZE = { width: 640, height: 320 } as const;
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { ...OBSERVED_SIZE } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// Same gap, different API: input-otp also polls document.elementFromPoint on an
// internal timer to track focus, which jsdom doesn't implement either. Without this
// it doesn't fail a test directly — the timer fires after the test that rendered
// the component has already finished and torn down — but it throws an uncaught
// exception into the run every time, which is not something to ship quietly even
// though every test still reports as passing. Returning null is the correct "found
// nothing at that point" answer, not just a silence.
document.elementFromPoint ??= () => null;

// jsdom does define window.scrollTo, but as a stub that logs "Not implemented:
// Window's scrollTo() method" on every call rather than leaving it undefined — so
// unlike the two stubs above, ??= never overrides it. TanStack Router calls it on
// every navigation. A plain reassignment is the fix; nothing under test asserts on
// actual scroll position.
window.scrollTo = () => {};

// jsdom has no Web Locks API, which the sync drain uses to keep two tabs from
// double-flushing. This minimal in-process stand-in grants exclusive locks in
// request order and answers `ifAvailable` with null while one is held, enough
// for a held-lock test to see a second drain skip. Real cross-tab behaviour is
// covered once, in #118's two-tab e2e.
const heldLocks = new Map<string, Promise<unknown>>();
async function requestLock(
  name: string,
  options: LockOptions | ((lock: Lock | null) => Promise<unknown>),
  maybeCallback?: (lock: Lock | null) => Promise<unknown>,
): Promise<unknown> {
  const callback = typeof options === "function" ? options : maybeCallback!;
  const ifAvailable = typeof options === "function" ? false : (options.ifAvailable ?? false);
  for (;;) {
    const held = heldLocks.get(name);
    if (held === undefined) break;
    if (ifAvailable) return callback(null);
    await held.catch(() => {});
  }
  const run = (async () => callback({ name, mode: "exclusive" }))();
  heldLocks.set(name, run);
  try {
    return await run;
  } finally {
    heldLocks.delete(name);
  }
}
(navigator as { locks?: LockManager }).locks ??= {
  request: requestLock,
} as LockManager;

// jsdom has no rendering engine, so it has no notion of media queries either —
// window.matchMedia is entirely absent. device-platform.ts calls it to detect a
// standalone PWA, so any test touching that needs this. Defaults to "not matched".
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
