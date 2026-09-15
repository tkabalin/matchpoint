import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { FieldLabelRow } from "./field-label-row";

test("marks a field required or optional beside its label", () => {
  const { rerender } = render(
    <FieldLabelRow htmlFor="first-name" required>
      First name
    </FieldLabelRow>,
  );

  expect(screen.getByText("(required)")).toBeInTheDocument();

  rerender(
    <FieldLabelRow htmlFor="first-name" required={false}>
      First name
    </FieldLabelRow>,
  );

  expect(screen.getByText("(optional)")).toBeInTheDocument();
});

// A field whose default already reads as "nothing chosen" (e.g. court type's
// "Unspecified") has no honest required/optional answer, so it opts out entirely.
test("omits the note when required is left unset", () => {
  render(<FieldLabelRow htmlFor="court-type">Court type</FieldLabelRow>);

  expect(screen.queryByText("(required)")).not.toBeInTheDocument();
  expect(screen.queryByText("(optional)")).not.toBeInTheDocument();
});

// The note is a sibling of the <label>, not inside it, so the input it labels keeps
// "First name" as its accessible name rather than "First name (required)".
test("keeps the note out of the labelled control's accessible name", () => {
  render(
    <>
      <FieldLabelRow htmlFor="first-name" required>
        First name
      </FieldLabelRow>
      <input id="first-name" />
    </>,
  );

  expect(screen.getByLabelText("First name")).toBeInTheDocument();
});
