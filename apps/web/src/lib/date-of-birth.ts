/**
 * The date-of-birth bounds, mirrored from the API.
 *
 * `apps/api/src/matchpoint_api/schemas/player.py` rejects a future date and one more
 * than 120 years ago, and says so in its own docstring: **JSON Schema can express
 * neither bound**, so the OpenAPI spec carries only `format: date` and the generated
 * client will happily send an out-of-range value and take the 422. This is the
 * hand-mirrored copy that keeps the coach from meeting that 422 (#77).
 *
 * Both are typo guards, not real validation — they catch a wrong century or a
 * transposed digit, not 1955 typed for 1995. Same ambition as the server's.
 */

export const MAX_AGE_YEARS = 120;

/** Today as `YYYY-MM-DD`, for an `<input type="date">` max. */
export function todayIso(): string {
  return toIso(new Date());
}

/** The earliest permitted date of birth, as `YYYY-MM-DD`. */
export function earliestDateOfBirthIso(): string {
  const earliest = new Date();
  // Approximate rather than calendar-exact, matching the server's own reasoning: an
  // exact boundary would need leap-day handling to buy precision a typo guard has
  // no use for.
  earliest.setFullYear(earliest.getFullYear() - MAX_AGE_YEARS);
  return toIso(earliest);
}

/**
 * Null when the date is acceptable, otherwise the message to show.
 *
 * Takes the raw `YYYY-MM-DD` string an `<input type="date">` produces and compares
 * as strings: ISO dates sort correctly, which sidesteps the local-vs-UTC midnight
 * trap that `.claude/rules/web.md` warns about for the API's own date fields.
 */
export function dateOfBirthError(value: string): string | null {
  if (value === "") return "Date of birth is required.";
  if (value > todayIso()) return "Date of birth cannot be in the future.";
  if (value < earliestDateOfBirthIso()) {
    return `Date of birth cannot be more than ${MAX_AGE_YEARS} years ago.`;
  }
  return null;
}

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
