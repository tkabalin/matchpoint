import { expect, test } from "@playwright/test";

test("loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign In (placeholder)" })).toBeVisible();
});

test("loads the player roster at /players", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("heading", { name: "MatchPoint" })).toBeVisible();
});
