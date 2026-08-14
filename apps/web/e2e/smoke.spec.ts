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

test("loads the home page at /home", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Welcome to Home" })).toBeVisible();
});

test("loads the forgot-password form at /forgot-password", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset Password" })).toBeVisible();
});
