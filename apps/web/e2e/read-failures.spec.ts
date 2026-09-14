import { expect, test } from "@playwright/test";

import { COACH_STORAGE_STATE } from "./coach";

/**
 * What the app shows when a read it needs fails.
 *
 * This is the one carve-out docs/testing.md makes for `page.route`: a healthy
 * backend cannot be asked for a 500 on demand, and the failure is the subject
 * rather than a detail of the setup. The mocked body carries FastAPI's own error
 * shape, since a mock that invents one is testing a response the API never sends.
 *
 * ---------------------------------------------------------------------------
 * IF YOU ARE HERE BECAUSE CI WENT RED WITH "Expected to fail, but passed":
 * that is the intended signal, not a broken test. #274 is now fixed. The only
 * change to make is to DELETE the `test.fail(...)` call in the test named in the
 * failure. Do not skip it, delete it, rewrite it, weaken its assertions, or
 * widen its timeouts — they are what prove the fix actually works.
 * ---------------------------------------------------------------------------
 */
test.use({ storageState: COACH_STORAGE_STATE });

/**
 * #274: the squad stats page reads no `isError`, so a failed roster query leaves
 * a full-page skeleton with nothing to say anything went wrong. `stats-page.tsx`
 * gates solely on `if (!roster)`, which is why the route below is the roster
 * endpoint rather than the squad one.
 *
 * Marked `test.fail()`: it pins a filed defect and turns red when #274 is fixed.
 */
test("squad stats says a failed read failed, rather than spinning", async ({ page }) => {
  // IF THIS TEST FAILS WITH "Expected to fail, but passed", #274 IS FIXED: delete the test.fail line below and change nothing else. Do not skip, delete or rewrite the test, and do not touch its assertions.
  test.fail(
    true,
    "#274 is not fixed yet: stats-page.tsx never reads isError, so a 500 renders as a " +
      'skeleton. When this reports "Expected to fail, but passed", #274 is fixed — delete ' +
      "this test.fail(...) call and nothing else.",
  );

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
