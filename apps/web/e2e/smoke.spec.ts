import { expect, test } from "@playwright/test";

import { COACH_DISPLAY_NAME, COACH_STORAGE_STATE } from "./coach";

test.describe("signed out", () => {
  test("loads the app shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });

  test("loads the sign-up form at /sign-up", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: "Sign Up" })).toBeVisible();
  });

  test("loads the forgot-password form at /forgot-password", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset Password" })).toBeVisible();
  });

  test("sends a visitor with no session back to sign in", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });
});

// Everything below /_authenticated answers 401 without a session and redirects, so these
// run as the coach auth.setup.ts signed up. Its cookies are the real ones a live API
// issued, which is what makes the redirect above a route guard rather than a stub.
test.describe("signed in", () => {
  test.use({ storageState: COACH_STORAGE_STATE });

  // The heading is the coach's own name once the profile has loaded, so this asserts
  // the session reached the API as well as that the route rendered.
  test("loads the home page at /home", async ({ page }) => {
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: `Coach ${COACH_DISPLAY_NAME}`, level: 1 }),
    ).toBeVisible();
  });

  test("loads the player roster at /players", async ({ page }) => {
    await page.goto("/players");
    await expect(page.getByRole("heading", { name: "Players", level: 1 })).toBeVisible();
  });

  // Proves the route resolves to the profile and not to the roster. The id belongs to no
  // player of this coach's, and the API answers 404 rather than 403 for one it cannot
  // see (#78), so "not found" is the branch a live API reaches here. The wait covers the
  // query client's three retries, which it spends on a 404 as on anything else.
  test("loads a player profile at /players/:playerId", async ({ page }) => {
    await page.goto("/players/3f1c2b4e-0000-4000-8000-000000000001");
    await expect(page.getByRole("alert")).toContainText("Player not found", {
      timeout: 20_000,
    });
  });

  test("loads the matches list at /matches", async ({ page }) => {
    await page.goto("/matches");
    await expect(page.getByRole("heading", { name: "Matches", level: 1 })).toBeVisible();
  });

  test("loads the start-a-match player search at /new-match", async ({ page }) => {
    await page.goto("/new-match");
    await expect(page.getByRole("heading", { name: "Start a match" })).toBeVisible();
  });

  test("loads the squad stats page at /stats", async ({ page }) => {
    await page.goto("/stats");
    await expect(page.getByRole("heading", { name: "Squad stats" })).toBeVisible();
  });

  // The heading is the coach's own display name, which profile-photo.spec.ts edits and
  // restores concurrently — asserting the role rather than the exact text keeps this
  // free of that race while still confirming a real coach record rendered (#179).
  test("loads the profile page at /profile", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("loads settings at /settings", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toBeVisible();
  });

  // Vitest's own settings tests build an in-memory route tree per file, so they
  // never exercise the real file-based one in routeTree.gen.ts — this is the one
  // check that would have caught #178's category routes resolving to an implicit
  // layout route with no <Outlet/>, silently re-rendering the Settings root instead
  // of navigating anywhere.
  test("drills into a settings category and back", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "Account & Security" }).click();
    await expect(page.getByRole("heading", { name: "Account & Security" })).toBeVisible();
    await page.getByRole("link", { name: "Back to settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
