import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AuthShell } from "./auth-shell";

test("renders the MATCHPOINT wordmark and its children", () => {
  render(
    <AuthShell>
      <h1>Sign In</h1>
    </AuthShell>,
  );

  expect(screen.getByText("MATCHPOINT")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});
