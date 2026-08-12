import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { SignIn } from "./sign-in";

test("renders the email and password fields", () => {
  render(<SignIn />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("updates the fields as the user types", async () => {
  const user = userEvent.setup();
  render(<SignIn />);

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("hunter2");
});

test("blocks submit until both fields are filled", async () => {
  const user = userEvent.setup();
  render(<SignIn />);

  const submit = screen.getByRole("button", { name: "Sign In" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Password"), "hunter2");
  expect(submit).toBeEnabled();
});
