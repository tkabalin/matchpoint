/**
 * FastAPI's `detail` field is not always a string. Every hand-written call in this
 * feature slice hits the same API, whose error bodies come in three shapes:
 *
 * - Most errors (401, 409, 429, 502, ...): `{ detail: "a message" }` — a string.
 * - 422 validation failures: `{ detail: [{ msg: "...", loc: [...], type: "..." }] }` —
 *   an array. Handing that array straight to `setError` and rendering `{error}` makes
 *   React throw ("Objects are not valid as a React child"), which unmounts the whole
 *   tree instead of showing anything (#51).
 * - A body that isn't JSON at all, or has no `detail` — `response.json()` itself can
 *   throw, and nothing here assumes it won't.
 *
 * This is the one place that reads a `detail`, so every call site gets all three
 * shapes handled the same way rather than each re-deciding what "detail" means.
 */
export async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail) && detail.length > 0) {
    const messages = detail
      .map((item: unknown) =>
        typeof item === "object" && item !== null && "msg" in item
          ? String((item as { msg: unknown }).msg)
          : null,
      )
      .filter((msg): msg is string => msg !== null);
    if (messages.length > 0) return messages.join(" ");
  }

  return fallback;
}
