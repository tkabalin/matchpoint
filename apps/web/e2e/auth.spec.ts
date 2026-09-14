import { expect, test, type Page } from "@playwright/test";

import { createPlayer, signUpCoach } from "./api";
import { openCapture, tapOutMatch } from "./capture";
import { readOutboxRows } from "./outbox";

/**
 * Signing in and signing out, against the live API.
 *
 * Both specs sign up a coach of their own and run from a blank storage state.
 * The shared session in coach.ts is a single token replayed into every context
 * in the run, and `logout` deletes the coach_sessions row it hashes to, so a
 * sign-out here would 401 every other signed-in spec still to come. A wrong
 * password is charged to a per-account budget, which is the same argument one
 * step down.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** Fills the sign-in form and submits it. */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  // Sign-in is the root route, not a path of its own (routes/index.tsx).
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  // exact, or the field's own "Show password" button matches the label too.
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

test("the wrong password is refused, and grants no session", async ({ page }) => {
  const { email } = await signUpCoach(page, {
    prefix: "auth-wrong",
    displayName: "Wrong Password Coach",
  });

  await signIn(page, email, "definitely-not-the-password-42");

  // The API says the same thing whether the address or the password was wrong,
  // and the form shows that verbatim rather than naming a field (sign-in.tsx).
  await expect(page.getByText("Incorrect email or password")).toBeVisible();

  // Refused means refused: the guard on an authenticated route sends this visit
  // straight back rather than rendering anything behind it.
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

/**
 * Signing out erases what the device held, queued points included.
 *
 * That the outbox goes with it is deliberate and asserted as such: #270 asks for
 * a warning before the purge, not for the points to survive it, so this stays
 * true once #270 lands.
 */
test("signing out erases what this device held", async ({ page }) => {
  const { email, password } = await signUpCoach(page, {
    prefix: "auth-signout",
    displayName: "Departing Coach",
  });
  await signIn(page, email, password);
  await expect(
    page.getByRole("heading", { name: "Coach Departing Coach", level: 1 }),
  ).toBeVisible();

  const playerId = await createPlayer(page, { firstName: "Tracked" });
  await openCapture(page, playerId);
  // Offline across the taps so the rows are still queued when the purge runs;
  // online they would drain before there was anything left to erase.
  await page.context().setOffline(true);
  await tapOutMatch(page, `E2E out ${crypto.randomUUID().slice(0, 8)}`, ["ace"]);
  expect(await readOutboxRows(page)).not.toHaveLength(0);
  await page.context().setOffline(false);

  await page.goto("/settings/account");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign Out" }).click();

  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  expect(await readOutboxRows(page)).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem("matchpoint:local-data-owner"))).toBeNull();
});
