import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Home } from "./home";

test("renders the welcome heading", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});
