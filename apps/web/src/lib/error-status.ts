/**
 * A thrown query error (e.g. from `useQuery`/`ensureQueryData`, which have no
 * `response` of their own to inspect) carries its HTTP status via
 * `packages/api-client/error-interceptor.ts`'s error interceptor. Reads it back out
 * defensively — a genuine network failure (`Error` instance) or anything unexpected
 * just yields `undefined` rather than throwing.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * The app's default `retry` for `QueryClient`. Most of a 4xx response means
 * retrying is never going to help — a bad request, an expired session, a
 * stale opponent key — so those fail fast instead of burning through
 * TanStack Query's default 3-attempt, multi-second exponential backoff
 * before a caller checking `isError`/`getErrorStatus` ever sees it. 429 is
 * the one exception its own backoff exists for; anything with no status (a
 * network failure) or a 5xx keeps the usual retry budget, since those can
 * genuinely be transient.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) return false;
  return failureCount < 3;
}
