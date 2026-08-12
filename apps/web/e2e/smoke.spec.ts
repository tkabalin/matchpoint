import { expect, test } from "@playwright/test";

test("loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
});

test("loads the player roster at /players", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "MatchPoint" })).toBeVisible();
});

test("loads the sign-up form at /sign-up", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Sign Up" })).toBeVisible();
});
