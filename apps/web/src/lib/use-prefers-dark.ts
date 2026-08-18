import { useSyncExternalStore } from "react";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/**
 * Tracks the OS color-scheme preference live (#176), same query the inline script
 * in index.html uses to set `.dark` on <html> before first paint. Most components
 * key off the `dark:` Tailwind variant instead; this is only for the rare case
 * (Logo's asset swap) that needs the raw boolean to pick between two whole assets.
 */
export function usePrefersDark() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
