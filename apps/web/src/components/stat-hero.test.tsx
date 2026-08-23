import { render, screen } from "@testing-library/react";
import { Swords } from "lucide-react";
import { expect, test } from "vitest";

import { StatHero } from "./stat-hero";

test("renders the value and label beside the icon", () => {
  render(<StatHero icon={Swords} value="1.8" label="Forced : Unforced ratio" />);

  expect(screen.getByText("1.8")).toBeInTheDocument();
  expect(screen.getByText("Forced : Unforced ratio")).toBeInTheDocument();
});
