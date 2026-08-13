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
