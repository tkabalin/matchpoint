const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Coarse "how long ago" for a millisecond timestamp — minutes, then hours,
 *  then days, matching the granularity the home screen's "Continue with"
 *  card actually needs rather than pulling in a full i18n duration library. */
export function relativeTimeFrom(timestampMs: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestampMs);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
