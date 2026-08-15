import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { StatsPage } from "./stats-page";

test("renders a coming-soon placeholder", () => {
  render(<StatsPage />);

  expect(screen.getByRole("heading", { name: "Stats — coming soon" })).toBeInTheDocument();
});
