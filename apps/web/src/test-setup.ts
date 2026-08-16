import { registerErrorStatusInterceptor } from "@matchpoint/api-client/error-interceptor";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Testing Library only registers its own auto-cleanup when Vitest's globals are on,
// and they are not. Without this, each test's render is left mounted in the same
// document, so the next one's queries match the previous test's output.
afterEach(cleanup);

// Mirrors main.tsx: without this, a test asserting on a thrown error's `.status`
// (see error-interceptor.ts) would run against an unregistered interceptor.
registerErrorStatusInterceptor();
