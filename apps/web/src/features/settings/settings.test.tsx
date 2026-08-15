import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { Settings } from "./settings";

test("renders the placeholder heading", () => {
  render(<Settings />);

  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
});
