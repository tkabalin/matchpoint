import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AuthShell } from "./auth-shell";

test("renders the MatchPoint mark and its children", () => {
  render(
    <AuthShell>
      <h1>Sign In</h1>
    </AuthShell>,
  );

  expect(screen.getByRole("img", { name: "MatchPoint" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});
