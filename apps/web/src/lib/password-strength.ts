import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

// One instance, built once at module load — same shape as every zxcvbn-ts setup:
// English + the common (cross-language) dictionary only, no extra language packs, to
// keep this PWA's bundle down to what the sign-up/reset/change-password screens
// actually need.
const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

// zxcvbn's own suggested "reasonably safe" cutoff (score is 0-4) — below this, a
// password is guessable enough that the form blocks submission on it.
export const PASSWORD_STRENGTH_MIN_SCORE = 2;

/**
 * `userInputs` should carry things specific to this coach (email, display name) —
 * zxcvbn penalizes a password for containing them, which is free client-side coverage
 * of part of the backend's context-specific rejection (see docs/security.md).
 */
export function getPasswordStrengthScore(password: string, userInputs: string[] = []): number {
  if (password === "") return 0;
  return zxcvbn.check(password, userInputs).score;
}
