import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { App } from "@/app";

test("renders the app shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "MatchPoint" })).toBeInTheDocument();
});
