import { expect, test, type Page } from "@playwright/test";

import { createPlayer, OWNER_KEY, postJson } from "./api";
import { COACH_STORAGE_STATE } from "./coach";
import { buildMatchLogRow, seedMatchLog } from "./outbox";

/**
 * The capture screen's side of the single-writer claim (#197), against a live API.
 * `web-tests.md` names the live capture flow as the canonical e2e case, and a real
 * two-device lease conflict is exactly what a mocked, single-context unit test
 * cannot prove.
 *
 * Only one browser context is driven through the UI. The "other device" is a raw
 * API call, the same way `offline.spec.ts`'s `completeMatchOnServer` stands in for
 * a second device deciding a match rather than opening a second browser to do it:
 * there is no UI path from a fresh device onto a match it never queued itself
 * (`findInProgressFor` is local-only, see `outbox.ts`'s `buildMatchLogRow`), so a
 * genuine second `Page` would still need this same seeding to get anywhere. What's
 * under test is this device's frontend behaviour, and that is exercised in full
 * regardless of how the conflict was put there.
 */
test.use({ storageState: COACH_STORAGE_STATE });

/**
 * A match already on the server and already claimed by a device standing in for
 * "the other device" — see the module doc comment above for why a raw claim call
 * is what puts this device's own claim attempt into a real conflict.
 */
async function createClaimedMatch(page: Page, playerId: string): Promise<string> {
  const matchId = crypto.randomUUID();
  const created = await postJson(page, "/api/matches", {
    id: matchId,
    player_id: playerId,
    played_on: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    scoring_system: "traditional",
  });
  expect(created.status()).toBe(201);
  const claimed = await postJson(page, `/api/matches/${matchId}/capture`, {
    // device_id is a UUID (MatchCaptureClaim), not an arbitrary string.
    device_id: crypto.randomUUID(),
  });
  expect(claimed.status()).toBe(200);
  return matchId;
}

test("takes over a match another device is capturing", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const coachId = await page.evaluate((key) => localStorage.getItem(key), OWNER_KEY);
  expect(coachId, "no owner recorded; did the authenticated route load?").not.toBeNull();

  const playerId = await createPlayer(page, { firstName: "Claim" });
  const matchId = await createClaimedMatch(page, playerId);
  // The only way onto this match's capture screen at all — see buildMatchLogRow.
  await seedMatchLog(page, [
    buildMatchLogRow({ coachId: coachId!, playerId, matchId, opponentName: "Other Device" }),
  ]);

  await page.goto(`/new-match/${playerId}`);

  const heading = page.getByRole("heading", { name: "Being captured on another device" });
  await expect(heading).toBeVisible();
  await expect(page.getByText(/Any points it's recorded but hasn't synced yet/)).toBeVisible();

  await page.getByRole("button", { name: "Take over" }).click();

  // The sheet closes on a successful takeover, and capture resumes into the
  // match this device just took over rather than sitting stuck on the prompt.
  await expect(heading).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});
