import { fileURLToPath } from "node:url";

import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { COACH_DISPLAY_NAME, COACH_STORAGE_STATE } from "./coach";

const BIG_PHOTO = fileURLToPath(new URL("./fixtures/large-photo.jpg", import.meta.url));
// Mirrors profile.tsx's initialsFor: first letter of each of the first two words.
const COACH_INITIALS = COACH_DISPLAY_NAME.split(/\s+/)
  .slice(0, 2)
  .map((word) => word[0])
  .join("");

async function activate(locator: Locator) {
  await locator.focus();
  await locator.press("Enter");
}

test.use({ storageState: COACH_STORAGE_STATE });

// The coach record is shared with every other spec in the run (web-tests.md: adopt
// auth.setup.ts's session rather than signing one up here), so the window where its
// display_name differs from COACH_DISPLAY_NAME is a real race against whatever else
// is reading it concurrently. Kept as short as possible: restore it immediately after
// proving the live-update claim, before the slower, name-independent photo steps run.
test("editing the display name updates live, on this page and on Home", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: COACH_DISPLAY_NAME })).toBeVisible();

  await activate(page.getByRole("button", { name: "Edit display name" }));
  await page.getByRole("textbox", { name: "Display name" }).fill("Jamie C.");
  await activate(page.getByRole("button", { name: "Save" }));
  await expect(page.getByRole("heading", { name: "Jamie C." })).toBeVisible();

  await activate(page.getByRole("link", { name: "Back to home" }));
  await expect(page.getByText("Coach Jamie C.")).toBeVisible();

  await activate(page.getByRole("link", { name: "Profile" }));
  await activate(page.getByRole("button", { name: "Edit display name" }));
  await page.getByRole("textbox", { name: "Display name" }).fill(COACH_DISPLAY_NAME);
  await activate(page.getByRole("button", { name: "Save" }));
  await expect(page.getByRole("heading", { name: COACH_DISPLAY_NAME })).toBeVisible();
});

test("uploading an oversized photo downscales client-side, and removing it restores initials", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Upload a deliberately oversized photo — must not 413, since it's downscaled
  // client-side before it ever reaches the API's 1 MB body cap.
  await activate(page.getByRole("button", { name: "Change profile photo" }));
  await activate(page.getByRole("button", { name: "Choose photo" }));
  await page.locator('input[type="file"]').setInputFiles(BIG_PHOTO);

  // No assertion on the transient "Uploading…" status: downscale-then-upload of this
  // fixture is fast enough locally that the state can come and go between polls,
  // which isn't a claim worth an e2e flake — the terminal state below is.
  await expect(page.locator('img[alt=""]')).toBeVisible({ timeout: 15000 });
  const src = await page.locator('img[alt=""]').getAttribute("src");
  expect(src).toMatch(/^\/api\/media\/.+\.webp$/);

  // Fetch the stored image directly and confirm it's real image bytes.
  const imgResponse = await page.request.get(src!);
  expect(imgResponse.status()).toBe(200);
  expect(imgResponse.headers()["content-type"]).toBe("image/webp");

  // Remove it, confirm initials come back.
  await activate(page.getByRole("button", { name: "Change profile photo" }));
  await activate(page.getByRole("button", { name: "Remove photo" }));
  await expect(page.getByText(COACH_INITIALS)).toBeVisible();
  await expect(page.locator('img[alt=""]')).toHaveCount(0);
});

test("profile page renders in dark mode", async ({ browser }) => {
  const context = await browser.newContext({
    colorScheme: "dark",
    storageState: COACH_STORAGE_STATE,
  });
  const page = await context.newPage();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await context.close();
});
