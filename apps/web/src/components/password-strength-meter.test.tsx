import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PasswordStrengthMeter } from "./password-strength-meter";

test("labels a score of 0 as very weak", () => {
  render(<PasswordStrengthMeter score={0} />);

  expect(screen.getByText("Very weak")).toBeInTheDocument();
});

test("labels a score of 4 as strong", () => {
  render(<PasswordStrengthMeter score={4} />);

  expect(screen.getByText("Strong")).toBeInTheDocument();
});

test("fills more of the bar for a higher score", () => {
  const { container: weak } = render(<PasswordStrengthMeter score={0} />);
  const { container: strong } = render(<PasswordStrengthMeter score={4} />);

  const weakFill = weak.querySelector("[style]");
  const strongFill = strong.querySelector("[style]");

  const weakWidth = Number(weakFill?.getAttribute("style")?.match(/(\d+)%/)?.[1]);
  const strongWidth = Number(strongFill?.getAttribute("style")?.match(/(\d+)%/)?.[1]);

  expect(strongWidth).toBeGreaterThan(weakWidth);
});
