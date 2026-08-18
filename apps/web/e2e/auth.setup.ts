import { expect, test as setup } from "@playwright/test";

import { COACH_DISPLAY_NAME, COACH_STORAGE_STATE } from "./coach";
import { readVerificationCode } from "./mail";

// Unique per run, so a retry of this file starts from an address that was never
// registered: the account the first attempt created would answer 409 to the second.
const email = `new-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
// Long enough for the strength meter and unrelated to the address, which the API
// penalises a password for echoing (password_policy.py).
const password = "rally-otter-lantern-92";

/**
 * Signs a coach up and in, and saves the session for the specs that need one.
 *
 * The whole point of running against a live API: this is the sign-up journey exactly as
 * a coach performs it, including the emailed code, which the API's file sender leaves
 * somewhere readable rather than the log (mail.ts). Nothing here is stubbed, so a
 * mismatch between the app and the real contract fails the run at its first step.
 */
setup("a coach can sign up and sign in", async ({ page }) => {
  await page.goto("/sign-up");

  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(`We sent a code to ${email}`)).toBeVisible();

  await page.getByLabel("Code").fill(readVerificationCode(email));
  await page.getByRole("button", { name: "Verify" }).click();

  await page.getByLabel("Display name").fill(COACH_DISPLAY_NAME);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Sign Up" }).click();

  // Sign-up lands on the sign-in form rather than signing the coach in itself, so the
  // session this saves is one the credentials just earned.
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  // exact, or the field's own "Show password" button matches the label too.
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(
    page.getByRole("heading", { name: `Coach ${COACH_DISPLAY_NAME}`, level: 1 }),
  ).toBeVisible();

  await page.context().storageState({ path: COACH_STORAGE_STATE });
});
