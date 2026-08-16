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
