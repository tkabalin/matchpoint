import type { PlayerRead } from "@matchpoint/api-client";
import { expect, test } from "vitest";

import { buildPlayerUpdateBody, playerFormValuesFrom, validatePlayerForm } from "./player-form";

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: "Strong two-handed backhand.",
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

test("playerFormValuesFrom maps every field, falling back for nullable ones", () => {
  expect(playerFormValuesFrom(player)).toEqual({
    firstName: "Amahle",
    lastName: "Nkosi",
    dateOfBirth: "2008-04-12",
    gender: "female",
    hand: "right",
    notes: "Strong two-handed backhand.",
  });

  expect(
    playerFormValuesFrom({
      ...player,
      date_of_birth: null,
      dominant_hand: null,
      gender: null,
      notes: null,
    }),
  ).toEqual({
    firstName: "Amahle",
    lastName: "Nkosi",
    dateOfBirth: "",
    gender: "",
    hand: "right",
    notes: "",
  });
});

test("validatePlayerForm requires a name, a valid date of birth, and a gender", () => {
  const values = playerFormValuesFrom(player);

  expect(validatePlayerForm(values)).toEqual({ dobError: null, genderError: null, isValid: true });
  expect(validatePlayerForm({ ...values, firstName: "  " }).isValid).toBe(false);
  expect(validatePlayerForm({ ...values, gender: "" }).genderError).toBe("Gender is required.");
  expect(validatePlayerForm({ ...values, dateOfBirth: "" }).dobError).toBe(
    "Date of birth is required.",
  );
});

test("buildPlayerUpdateBody is empty when nothing changed", () => {
  expect(buildPlayerUpdateBody(player, playerFormValuesFrom(player))).toEqual({});
});

test("buildPlayerUpdateBody includes only the fields that changed", () => {
  const values = { ...playerFormValuesFrom(player), firstName: "Amahle-Jane" };

  expect(buildPlayerUpdateBody(player, values)).toEqual({ first_name: "Amahle-Jane" });
});

test("buildPlayerUpdateBody trims names and notes before comparing and sending", () => {
  const values = { ...playerFormValuesFrom(player), firstName: "  Amahle  " };

  // Trimmed value equals the original, so this is a no-op change — not "  Amahle  ".
  expect(buildPlayerUpdateBody(player, values)).toEqual({});
});

test("buildPlayerUpdateBody sends null for notes cleared back to empty", () => {
  const values = { ...playerFormValuesFrom(player), notes: "   " };

  expect(buildPlayerUpdateBody(player, values)).toEqual({ notes: null });
});

test("buildPlayerUpdateBody can include several changed fields at once", () => {
  const values = { ...playerFormValuesFrom(player), lastName: "Khumalo", hand: "left" as const };

  expect(buildPlayerUpdateBody(player, values)).toEqual({
    last_name: "Khumalo",
    dominant_hand: "left",
  });
});
