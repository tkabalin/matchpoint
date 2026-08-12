import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { SignUp } from "./sign-up";

test("renders the email field", () => {
  render(<SignUp />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("updates the field as the user types", async () => {
  const user = userEvent.setup();
  render(<SignUp />);

  await user.type(screen.getByLabelText("Email"), "coach@example.com");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
});

test("blocks submit until the email is filled", async () => {
  const user = userEvent.setup();
  render(<SignUp />);

  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeEnabled();
});
