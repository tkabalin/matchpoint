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
