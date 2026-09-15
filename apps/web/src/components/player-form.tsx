import { FieldLabelRow } from "@/components/field-label-row";
import { SegmentedControl } from "@/components/segmented-control";
import { Field, FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { earliestDateOfBirthIso, todayIso } from "@/lib/date-of-birth";
import {
  PLAYER_NAME_MAX,
  PLAYER_NOTES_MAX,
  type PlayerFormValues,
  validatePlayerForm,
} from "@/lib/player-form";

/**
 * The field set shared by `AddPlayerSheet` and `EditPlayerSheet` — same fields, same
 * validation, same required/optional split, just a different starting point and a
 * different mutation on submit.
 */
export function PlayerFormFields({
  values,
  onChange,
  showErrors,
}: {
  values: PlayerFormValues;
  onChange: <K extends keyof PlayerFormValues>(key: K, value: PlayerFormValues[K]) => void;
  showErrors: boolean;
}) {
  const { dobError, genderError } = validatePlayerForm(values);

  return (
    <FieldGroup>
      <Field data-invalid={showErrors && values.firstName.trim() === "" ? true : undefined}>
        <FieldLabelRow htmlFor="first-name" required>
          First name
        </FieldLabelRow>
        <Input
          id="first-name"
          autoComplete="given-name"
          maxLength={PLAYER_NAME_MAX}
          value={values.firstName}
          onChange={(event) => onChange("firstName", event.target.value)}
        />
        {showErrors && values.firstName.trim() === "" && (
          <FieldError>First name is required.</FieldError>
        )}
      </Field>

      <Field data-invalid={showErrors && values.lastName.trim() === "" ? true : undefined}>
        <FieldLabelRow htmlFor="last-name" required>
          Last name
        </FieldLabelRow>
        <Input
          id="last-name"
          autoComplete="family-name"
          maxLength={PLAYER_NAME_MAX}
          value={values.lastName}
          onChange={(event) => onChange("lastName", event.target.value)}
        />
        {showErrors && values.lastName.trim() === "" && (
          <FieldError>Last name is required.</FieldError>
        )}
      </Field>

      <Field data-invalid={showErrors && dobError !== null ? true : undefined}>
        <FieldLabelRow htmlFor="date-of-birth" required>
          Date of birth
        </FieldLabelRow>
        <Input
          id="date-of-birth"
          type="date"
          // Native bounds as well as the checked ones: they narrow the picker
          // itself, which stops most wrong-century typos before they happen.
          min={earliestDateOfBirthIso()}
          max={todayIso()}
          value={values.dateOfBirth}
          onChange={(event) => onChange("dateOfBirth", event.target.value)}
        />
        {showErrors && dobError !== null && <FieldError>{dobError}</FieldError>}
      </Field>

      <Field data-invalid={showErrors && genderError !== null ? true : undefined}>
        <FieldLabelRow htmlFor="gender" required>
          Gender
        </FieldLabelRow>
        <SegmentedControl
          aria-label="Gender"
          value={values.gender}
          onValueChange={(value) => onChange("gender", value)}
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "other", label: "Other" },
          ]}
        />
        {showErrors && genderError !== null && <FieldError>{genderError}</FieldError>}
      </Field>

      <Field>
        <FieldLabelRow htmlFor="dominant-hand" required={false}>
          Dominant hand
        </FieldLabelRow>
        <SegmentedControl
          aria-label="Dominant hand"
          value={values.hand}
          onValueChange={(value) => onChange("hand", value)}
          options={[
            { value: "right", label: "Right" },
            { value: "left", label: "Left" },
          ]}
        />
      </Field>

      <Field>
        <FieldLabelRow htmlFor="player-notes" required={false}>
          Notes
        </FieldLabelRow>
        <Textarea
          id="player-notes"
          maxLength={PLAYER_NOTES_MAX}
          value={values.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          placeholder="Anything worth remembering before the first session"
        />
      </Field>
    </FieldGroup>
  );
}
