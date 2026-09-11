/**
 * The note date (`recorded_on`) bounds, mirrored from the API.
 *
 * `apps/api/src/matchpoint_api/schemas/player_note.py`'s `_reject_implausible_recorded_on`
 * rejects a future date and one more than 10 years back, and says why in its own
 * docstring: **JSON Schema can express neither bound**, so the generated client will
 * happily send an out-of-range value and take the 422. This is the hand-mirrored copy
 * that keeps a coach from meeting that 422 — same reasoning as `lib/date-of-birth.ts`,
 * which exists for the identical gap on a different field.
 *
 * Both are typo guards, not real validation — a wrong century or a transposed digit,
 * not last Tuesday typed for this one. Same ambition as the server's.
 */

const MAX_PAST_YEARS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Today as `YYYY-MM-DD`, for an `<input type="date">` max. */
export function todayIso(): string {
  return toIso(new Date());
}

/** The earliest permitted note date, as `YYYY-MM-DD`. */
export function earliestRecordedOnIso(): string {
  // Days, not `setFullYear`, to match the server's own `timedelta(days=365.25 *
  // MAX_PAST_YEARS)` bound exactly — a calendar-year subtraction lands a day or two
  // off depending on how many leap years fall in the span, which would let this pass
  // a date the server still refuses.
  const earliest = new Date(Date.now() - 365.25 * MAX_PAST_YEARS * MS_PER_DAY);
  return toIso(earliest);
}

/**
 * Null when the date is acceptable, otherwise the message to show.
 *
 * Takes the raw `YYYY-MM-DD` string an `<input type="date">` produces and compares as
 * strings: ISO dates sort correctly, which sidesteps the local-vs-UTC midnight trap
 * `.claude/rules/web.md` warns about for the API's own date fields.
 */
export function recordedOnError(value: string): string | null {
  if (value === "") return "Note date is required.";
  if (value > todayIso()) return "Note date cannot be in the future.";
  if (value < earliestRecordedOnIso()) {
    return `Note date cannot be more than ${MAX_PAST_YEARS} years ago.`;
  }
  return null;
}

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
