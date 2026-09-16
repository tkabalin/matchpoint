import { expect, test } from "@playwright/test";

import { COACH_STORAGE_STATE } from "./coach";

/**
 * What the app shows when a read it needs fails.
 *
 * This is the one carve-out docs/testing.md makes for `page.route`: a healthy
 * backend cannot be asked for a 500 on demand, and the failure is the subject
 * rather than a detail of the setup. The mocked body carries FastAPI's own error
 * shape, since a mock that invents one is testing a response the API never sends.
 */
test.use({ storageState: COACH_STORAGE_STATE });

/**
 * #274: the squad stats page used to read no `isError`, so a failed roster query
 * left a full-page skeleton with nothing to say anything went wrong.
 * `stats-page.tsx` now gates on `isError` before the `!roster` skeleton check,
 * which is why the route below is the roster endpoint rather than the squad one.
 */
test("squad stats says a failed read failed, rather than spinning", async ({ page }) => {
  await page.route("**/api/players", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Internal Server Error" }),
    });
  });

  await page.goto("/stats");
  await expect(page.getByRole("heading", { name: "Squad stats" })).toBeVisible();
  // Short: the page either tells the coach or it does not, and a green run pays
  // this wait on every one.
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 8_000 });
});
