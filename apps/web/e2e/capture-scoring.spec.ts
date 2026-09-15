import { expect, test } from "@playwright/test";

import { createPlayer, openHome } from "./api";
import { openCapture, skipPoint, startMatch } from "./capture";
import { COACH_STORAGE_STATE } from "./coach";

/**
 * The score reaching a real boundary through real taps, on a real screen.
 *
 * score.test.ts already proves the fold engine's own rules (deuce, ad-scoring,
 * game/set boundaries) exhaustively, and live-match.test.tsx proves the DOM
 * projection of them at the integration level, jumping near a boundary with the
 * score editor. Neither drives a live browser: capture.spec.ts's own specs always
 * award every skipped point to the tracked player, so a game there never reaches
 * deuce. These do, through the same Skip point path those specs use, which is what
 * makes this the one place a coach's actual tap sequence through a deuce game is
 * exercised at all. Runs on every project — a single game is cheap enough for
 * mobile-chromium and mobile-webkit too.
 *
 * capture-scoring-tiebreak.spec.ts covers the other score.test.ts boundary this
 * suite was missing (a set reaching games-all) separately, since reaching one costs
 * enough points to be desktop-only.
 */
test.use({ storageState: COACH_STORAGE_STATE });

test("a game reaching deuce shows AD before the win", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E deuce ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  // Default scoring system is "Traditional" (state.ts), which plays with ad — the
  // one format where a game past 40-40 goes to AD rather than ending outright.
  await startMatch(page, marker);

  const score = page.getByRole("table", { name: "Score" });
  // rows[0] is always the tracked player, rows[1] always the opponent — match-header.tsx
  // builds the table from that fixed pair, so position is a stable locator, unlike the
  // player's own name, which the deuce and AD cells briefly share ("40" both sides).
  const trackedRow = score.getByRole("row").nth(0);
  const opponentRow = score.getByRole("row").nth(1);
  const trackedCall = () => trackedRow.getByRole("cell").nth(1);
  const opponentCall = () => opponentRow.getByRole("cell").nth(1);

  // 15-15, 30-30, 40-40: three points each way reaches deuce.
  for (let taken = 0; taken < 3; taken += 1) {
    await skipPoint(page, true);
    await skipPoint(page, false);
  }
  await expect(trackedCall()).toHaveText("40");
  await expect(opponentCall()).toHaveText("40");

  await skipPoint(page, true);
  await expect(trackedCall()).toHaveText("AD");
  await expect(opponentCall()).toHaveText("40");

  await skipPoint(page, true);
  await expect(page.getByText("Game won")).toBeVisible();
  await expect(trackedRow.getByRole("cell").nth(0)).toHaveText("1");
});

test("undoing a game-winning point reverts the score and capture continues", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E undo ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker);

  const score = page.getByRole("table", { name: "Score" });
  const trackedRow = score.getByRole("row").nth(0);
  const games = () => trackedRow.getByRole("cell").nth(0);
  const call = () => trackedRow.getByRole("cell").nth(1);

  await skipPoint(page, true); // 15-0
  await skipPoint(page, true); // 30-0
  await skipPoint(page, true); // 40-0
  await expect(call()).toHaveText("40");

  await skipPoint(page, true); // wins the game, love
  await expect(games()).toHaveText("1");

  // Back past a just-recorded point offers to undo it (live-match.test.tsx's own
  // integration test for this asks the same way) — this is that same journey
  // through a real tap instead of Testing Library.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Undo the last point?" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();

  await expect(games()).toHaveText("0");
  await expect(call()).toHaveText("40");

  // The coach can keep capturing after the undo rather than the flow getting stuck.
  await skipPoint(page, true);
  await expect(games()).toHaveText("1");
});
