import type { CreateClientConfig } from "./src/client.gen";

/**
 * The client's base URL, resolved when the client is created.
 *
 * `/api` on the app's own origin is where the API lives in every environment — Caddy
 * strips the prefix in production, the Vite dev proxy does locally — so this is one
 * value, not a per-environment setting. It is spelled out to an absolute URL rather
 * than left as the relative `/api` because the client builds a `Request`, and outside
 * a real browser (jsdom under Vitest) `Request` rejects a URL with no origin.
 *
 * `location` is read optionally because this module is evaluated on import: somewhere
 * without a DOM — a Node-environment test, a script, a prerender step — a bare
 * `globalThis.location.origin` would throw before any request was ever made. Falling
 * back to the relative form leaves that failure to the call that actually fetches.
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: `${globalThis.location?.origin ?? ""}/api`,
});
