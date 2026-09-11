import type { NoteFocus, PlayerNoteRead, PlayerNoteUpdate } from "@matchpoint/api-client";

import { recordedOnError, todayIso } from "@/lib/note-date";

// Mirrored from the spec's LongText constraint (`schemas/types.py`), which the
// generated client types but does not enforce — same hand-mirroring caveat
// `player-form.ts`'s own PLAYER_NOTES_MAX carries.
export const NOTE_BODY_MAX = 2000;

// Declaration order matters: the server canonicalises `focus_areas` to this exact
// order and dedupes (`_canonical_focus_areas` in `schemas/player_note.py`), so the
// picker has to offer them in the order the server will echo back, or a save would
// silently reorder a coach's own selection on the next read.
export const NOTE_FOCUS_OPTIONS: readonly NoteFocus[] = [
  "technical",
  "mental",
  "physical",
  "tactical",
];

export interface NoteFormValues {
  body: string;
  recordedOn: string;
  focusAreas: NoteFocus[];
}

export function blankNoteForm(): NoteFormValues {
  return { body: "", recordedOn: todayIso(), focusAreas: [] };
}

/** The values an existing note's record maps to when opening it for editing. */
export function noteFormValuesFrom(note: PlayerNoteRead): NoteFormValues {
  return { body: note.body, recordedOn: note.recorded_on, focusAreas: [...note.focus_areas] };
}

export function validateNoteForm(values: NoteFormValues) {
  const bodyError = values.body.trim() === "" ? "Note can't be empty." : null;
  const dateError = recordedOnError(values.recordedOn);
  const isValid = bodyError === null && dateError === null;
  return { bodyError, dateError, isValid };
}

/** Focus areas compared by their canonical joined order, so a selection that only
 *  reordered (never actually changing the set) doesn't send a needless PATCH field. */
function focusAreasKey(areas: readonly NoteFocus[]): string {
  return NOTE_FOCUS_OPTIONS.filter((area) => areas.includes(area)).join(",");
}

/**
 * Diffs edited form values against the note's original record, so a save only
 * PATCHes what actually changed — `PlayerNoteUpdate` is a true partial, same
 * reasoning as `player-form.ts`'s `buildPlayerUpdateBody`.
 *
 * `focus_areas` is the one field where "changed" needs care: an empty list is how a
 * coach clears the areas a note is filed under, and the server takes `null` as a 422,
 * so this only ever sends `[]` or a real list, never omits it once the set changed.
 */
export function buildNoteUpdateBody(
  original: PlayerNoteRead,
  values: NoteFormValues,
): PlayerNoteUpdate {
  const body: PlayerNoteUpdate = {};

  const trimmedBody = values.body.trim();
  if (trimmedBody !== original.body) body.body = trimmedBody;
  if (values.recordedOn !== original.recorded_on) body.recorded_on = values.recordedOn;
  if (focusAreasKey(values.focusAreas) !== focusAreasKey(original.focus_areas)) {
    body.focus_areas = NOTE_FOCUS_OPTIONS.filter((area) => values.focusAreas.includes(area));
  }

  return body;
}
