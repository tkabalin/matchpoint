import type { ErrorDetail, HttpValidationError } from "@matchpoint/api-client";

/**
 * The generated client's non-throwing mode (`{data, error, response}`) already parses
 * the body, so `error` arrives typed as one of the endpoint's declared error responses
 * — no more guessing at a response's shape (#51: 422s are `{detail: Array<...>}`, not
 * the `{detail: string}` every other error is).
 *
 * `error` can also be a network failure the client caught internally (`fetch` itself
 * threw — no response ever arrived), which isn't shaped like either of those. That's
 * the `instanceof Error` branch.
 */
export function parseErrorMessage(
  error: ErrorDetail | HttpValidationError | Error | undefined,
  fallback: string,
): string {
  if (error instanceof Error) return "Could not reach the server. Try again.";

  const detail = error?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail.map((item) => item.msg).filter((msg): msg is string => Boolean(msg));
    if (messages.length > 0) return messages.join(" ");
  }

  return fallback;
}

/**
 * A 429's `Retry-After` header is a delta in seconds, not a timestamp — these are
 * token buckets, not fixed windows, so the wait shortens as tokens refill. Read fresh
 * off each response rather than cached and counted down from a stale figure.
 */
export function getRetryAfterSeconds(response: Response | undefined): number | null {
  const header = response?.headers.get("Retry-After");
  if (!header) return null;

  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * A thrown query error (e.g. from `useQuery`/`ensureQueryData`, which have no
 * `response` of their own to inspect) carries its HTTP status via
 * `packages/api-client/runtime-config.ts`'s error interceptor. Reads it back out
 * defensively — a genuine network failure (`Error` instance) or anything unexpected
 * just yields `undefined` rather than throwing.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
