import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { PasswordInput } from "./password-input";

function Wrapper() {
  return <PasswordInput id="password" value="hunter2000" onChange={() => undefined} />;
}

test("starts masked", () => {
  render(<Wrapper />);

  expect(document.getElementById("password")).toHaveAttribute("type", "password");
  expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
});

test("toggling reveals the password, and toggling again re-masks it", async () => {
  const user = userEvent.setup();
  render(<Wrapper />);

  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(document.getElementById("password")).toHaveAttribute("type", "text");

  await user.click(screen.getByRole("button", { name: "Hide password" }));
  expect(document.getElementById("password")).toHaveAttribute("type", "password");
});
