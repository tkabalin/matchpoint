// Defined by Vite from apps/web/package.json; see the `define` block in vite.config.ts.
declare const __APP_VERSION__: string;

/**
 * The build's app version, read once at build time from `package.json`.
 *
 * Two real consumers: `query-persist.ts`'s cache buster, and Settings' own
 * "App version" row (#195) — promoted here once there were two, per this
 * project's own two-call-site rule, rather than each declaring `__APP_VERSION__`
 * for itself.
 */
export const APP_VERSION = __APP_VERSION__;
