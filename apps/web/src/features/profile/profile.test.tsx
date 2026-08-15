import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Profile } from "./profile";

test("renders the placeholder heading", () => {
  render(<Profile />);

  expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
});
