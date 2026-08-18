import { registerErrorStatusInterceptor } from "@matchpoint/api-client/error-interceptor";
import { cleanup, configure } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Testing Library only registers its own auto-cleanup when Vitest's globals are on,
// and they are not. Without this, each test's render is left mounted in the same
// document, so the next one's queries match the previous test's output.
afterEach(cleanup);

// `testTimeout` in vite.config.ts bounds a whole test, but findBy*/waitFor keep their
// own budget, which defaults to 1s. The runner's contention has pushed a router
// redirect past that, so these get the slack that timeout's 15s already assumes.
configure({ asyncUtilTimeout: 5_000 });

// Mirrors main.tsx: without this, a test asserting on a thrown error's `.status`
// (see error-interceptor.ts) would run against an unregistered interceptor.
registerErrorStatusInterceptor();

// jsdom implements no layout, so it has no ResizeObserver — the input-otp package
// (shadcn's InputOTP, #148) uses one internally to size itself, and every test
// rendering it throws "ResizeObserver is not defined" without this. A no-op stub is
// enough: nothing under test asserts on a real resize.
class ResizeObserverStub {
  observe() {}
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

// jsdom has no rendering engine, so it has no notion of media queries either —
// window.matchMedia is entirely absent. usePrefersDark (#176) calls it on every
// render, so every test touching Logo needs this. Defaults to "not matched" (light):
// no test currently asserts on the OS being in dark mode.
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
