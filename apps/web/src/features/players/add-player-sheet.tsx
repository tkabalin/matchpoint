import { createPlayer } from "@matchpoint/api-client";
import { listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { dateOfBirthError, earliestDateOfBirthIso, todayIso } from "@/lib/date-of-birth";
import { parseErrorMessage } from "@/lib/parse-error";

type Hand = "right" | "left";
/** "" is the unpicked state — gender is required, so it starts with nothing chosen. */
type GenderChoice = "male" | "female" | "other" | "";

// Mirrored from the spec's maxLength, which the generated client types but does not
// enforce — the same hand-mirroring caveat sign-up.tsx already carries.
const NAME_MAX = 100;
const NOTES_MAX = 2000;

/**
 * Adding a player.
 *
 * Everything except notes is required. Player setup is done ahead of time rather
 * than courtside, so this is the one place a coach can be asked for the full record
 * — the speed constraint in the brief is about capturing points during a match, not
 * about this form.
 */
export function AddPlayerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<GenderChoice>("");
  const [hand, setHand] = useState<Hand>("right");
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setDateOfBirth("");
    setGender("");
    setHand("right");
    setNotes("");
    setShowErrors(false);
    setError(null);
  }

  const dobError = dateOfBirthError(dateOfBirth);
  const genderError = gender === "" ? "Gender is required." : null;
  const isValid =
    firstName.trim() !== "" && lastName.trim() !== "" && dobError === null && genderError === null;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      const { data, error: createError } = await createPlayer({
        body: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: dateOfBirth,
          // Narrowed by `isValid` before this runs, so the empty member is gone.
          gender: gender as Exclude<GenderChoice, "">,
          dominant_hand: hand,
          notes: notes.trim() === "" ? null : notes.trim(),
        },
      });
      if (createError) throw createError;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: listPlayersQueryKey() });
      reset();
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(parseErrorMessage(mutationError, "Could not add that player."));
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Add a player</SheetTitle>
        </SheetHeader>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            // Errors stay hidden until the first submit, so the form doesn't scold
            // the coach about fields they haven't reached yet.
            setShowErrors(true);
            if (isValid) mutate();
          }}
        >
          <FieldGroup>
            <Field data-invalid={showErrors && firstName.trim() === "" ? true : undefined}>
              <FieldLabel htmlFor="first-name">First name</FieldLabel>
              <Input
                id="first-name"
                autoComplete="given-name"
                maxLength={NAME_MAX}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
              {showErrors && firstName.trim() === "" && (
                <FieldError>First name is required.</FieldError>
              )}
            </Field>

            <Field data-invalid={showErrors && lastName.trim() === "" ? true : undefined}>
              <FieldLabel htmlFor="last-name">Last name</FieldLabel>
              <Input
                id="last-name"
                autoComplete="family-name"
                maxLength={NAME_MAX}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
              {showErrors && lastName.trim() === "" && (
                <FieldError>Last name is required.</FieldError>
              )}
            </Field>

            <Field data-invalid={showErrors && dobError !== null ? true : undefined}>
              <FieldLabel htmlFor="date-of-birth">Date of birth</FieldLabel>
              <Input
                id="date-of-birth"
                type="date"
                // Native bounds as well as the checked ones: they narrow the picker
                // itself, which stops most wrong-century typos before they happen.
                min={earliestDateOfBirthIso()}
                max={todayIso()}
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
              {showErrors && dobError !== null && <FieldError>{dobError}</FieldError>}
            </Field>

            <Field data-invalid={showErrors && genderError !== null ? true : undefined}>
              <FieldLabel htmlFor="gender">Gender</FieldLabel>
              <SegmentedControl
                aria-label="Gender"
                value={gender}
                onValueChange={setGender}
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                ]}
              />
              {showErrors && genderError !== null && <FieldError>{genderError}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="dominant-hand">Dominant hand</FieldLabel>
              <SegmentedControl
                aria-label="Dominant hand"
                value={hand}
                onValueChange={setHand}
                options={[
                  { value: "right", label: "Right" },
                  { value: "left", label: "Left" },
                ]}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="player-notes">Notes</FieldLabel>
              <Textarea
                id="player-notes"
                maxLength={NOTES_MAX}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional — anything worth remembering before the first session"
              />
            </Field>
          </FieldGroup>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Adding…" : "Add player"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
