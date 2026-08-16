import { expect, test } from "vitest";

import { PASSWORD_STRENGTH_MIN_SCORE, getPasswordStrengthScore } from "./password-strength";

test("scores an empty password as 0", () => {
  expect(getPasswordStrengthScore("")).toBe(0);
});

test("scores an obviously weak password below the submit-gating threshold", () => {
  expect(getPasswordStrengthScore("password1")).toBeLessThan(PASSWORD_STRENGTH_MIN_SCORE);
});

test("scores a long, random passphrase above the submit-gating threshold", () => {
  expect(getPasswordStrengthScore("correct-horse-battery-staple-9247")).toBeGreaterThanOrEqual(
    PASSWORD_STRENGTH_MIN_SCORE,
  );
});

test("penalizes a password for containing a supplied user input", () => {
  const withoutContext = getPasswordStrengthScore("amahlenkosi2026x");
  const withContext = getPasswordStrengthScore("amahlenkosi2026x", [
    "amahle@example.com",
    "Amahle Nkosi",
  ]);

  expect(withContext).toBeLessThanOrEqual(withoutContext);
});
