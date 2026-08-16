import { client } from "./src/client.gen";

/**
 * On a failed request, the generated client reads the response body and throws just
 * that (e.g. `{detail: "Not signed in"}`) — `response.status` is never attached, so
 * call sites have no reliable way to ask "was this a 401?" without guessing from
 * message text. This attaches it.
 *
 * Kept out of `runtime-config.ts` deliberately: `client.gen.ts` imports
 * `createClientConfig` from that file, so this file importing `client` back from
 * `client.gen.ts` would make `runtime-config.ts` part of an import cycle — whichever
 * module entered the cycle first would see `createClientConfig` before it had a value.
 * This file only depends on the already-built `client` singleton, so it stays a
 * one-way edge. Called once from the app's entry point (`apps/web/src/main.tsx`) and
 * from `apps/web/src/test-setup.ts`.
 */
export function registerErrorStatusInterceptor(): void {
  client.interceptors.error.use((error, response) => {
    // A network failure (fetch itself threw) is already an Error instance the rest of
    // the app depends on recognising via `instanceof Error` — spreading it would lose
    // that (Error's own fields aren't enumerable), so it passes through untouched.
    if (error instanceof Error) return error;

    if (typeof error === "object" && error !== null) {
      return { ...error, status: response?.status };
    }

    return error;
  });
}
