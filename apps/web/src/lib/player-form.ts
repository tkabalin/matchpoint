import type { Gender, PlayerRead, PlayerUpdate } from "@matchpoint/api-client";

import { dateOfBirthError } from "@/lib/date-of-birth";

export type Hand = "right" | "left";
/** "" is the unpicked state — gender is required, so it starts with nothing chosen. */
export type GenderChoice = Gender | "";
/** "" is the unpicked state — dominant hand is optional, and a preselected side
 *  wouldn't actually be optional to the coach filling this in. */
export type HandChoice = Hand | "";

// Mirrored from the spec's maxLength, which the generated client types but does not
// enforce — the same hand-mirroring caveat sign-up.tsx already carries.
export const PLAYER_NAME_MAX = 100;
export const PLAYER_NOTES_MAX = 2000;

export type PlayerFormValues = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: GenderChoice;
  hand: HandChoice;
  notes: string;
};

export const BLANK_PLAYER_FORM: PlayerFormValues = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  hand: "",
  notes: "",
};

/** The values an existing player's record maps to when opening it for editing. */
export function playerFormValuesFrom(player: PlayerRead): PlayerFormValues {
  return {
    firstName: player.first_name,
    lastName: player.last_name,
    dateOfBirth: player.date_of_birth ?? "",
    gender: player.gender ?? "",
    hand: player.dominant_hand ?? "",
    notes: player.notes ?? "",
  };
}

export function validatePlayerForm(values: PlayerFormValues) {
  const dobError = dateOfBirthError(values.dateOfBirth);
  const genderError = values.gender === "" ? "Gender is required." : null;
  const isValid =
    values.firstName.trim() !== "" &&
    values.lastName.trim() !== "" &&
    dobError === null &&
    genderError === null;
  return { dobError, genderError, isValid };
}

/**
 * Diffs edited form values against the player's original record, so a save only
 * PATCHes what actually changed — `PlayerUpdate` is a true partial, and sending
 * every field on every save would blow away a concurrent edit to a field this form
 * never touched.
 */
export function buildPlayerUpdateBody(
  original: PlayerRead,
  values: PlayerFormValues,
): PlayerUpdate {
  const body: PlayerUpdate = {};

  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  const notes = values.notes.trim() === "" ? null : values.notes.trim();
  const gender = values.gender === "" ? null : values.gender;
  const hand = values.hand === "" ? null : values.hand;

  if (firstName !== original.first_name) body.first_name = firstName;
  if (lastName !== original.last_name) body.last_name = lastName;
  if (values.dateOfBirth !== (original.date_of_birth ?? ""))
    body.date_of_birth = values.dateOfBirth;
  if (gender !== original.gender) body.gender = gender;
  if (hand !== original.dominant_hand) body.dominant_hand = hand;
  if (notes !== original.notes) body.notes = notes;

  return body;
}
