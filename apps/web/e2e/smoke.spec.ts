import { expect, test } from "@playwright/test";

test("loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

test("loads the player roster at /players", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "Players", level: 1 })).toBeVisible();
});

// No API is running behind these, so the profile can only get as far as its error
// state — enough to prove the route resolves to the profile and not to the roster.
// The wait covers the query client's three retries before it gives up.
test("loads a player profile at /players/:playerId", async ({ page }) => {
  await page.goto("/players/3f1c2b4e-0000-4000-8000-000000000001");
  await expect(page.getByRole("alert")).toHaveText("Could not load that player.", {
    timeout: 20_000,
  });
});

test("loads the sign-up form at /sign-up", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Sign Up" })).toBeVisible();
});

test("loads the home page at /home", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
});

test("loads the forgot-password form at /forgot-password", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset Password" })).toBeVisible();
});

test("loads the matches list at /matches", async ({ page }) => {
  await page.goto("/matches");
  await expect(page.getByRole("heading", { name: "Matches", level: 1 })).toBeVisible();
});

test("loads the start-a-match player search at /new-match", async ({ page }) => {
  await page.goto("/new-match");
  await expect(page.getByRole("heading", { name: "Start a match" })).toBeVisible();
});

test("loads the stats placeholder at /stats", async ({ page }) => {
  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Stats — coming soon" })).toBeVisible();
});

test("loads the profile placeholder at /profile", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
});

test("loads settings at /settings", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible();
});
