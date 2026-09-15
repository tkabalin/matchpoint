import { expect, test } from "@playwright/test";

import { createPlayer, openHome } from "./api";
import { openCapture, skipPoint, startMatch, winGame } from "./capture";
import { COACH_STORAGE_STATE } from "./coach";

/**
 * A set reaching games-all, entering and decided by a tiebreak, through real taps.
 *
 * The other half of the score-boundary gap capture-scoring.spec.ts's deuce test
 * covers — see that file's own doc comment. Kept in its own file, in
 * playwright.config.ts's DESKTOP_ONLY list, the same way capture-sync.spec.ts's
 * full-match sweep is: even "Short Sets" (state.ts's cheapest tiebreak-bearing
 * format, breaking at games 3-3) costs ~30 skipped points to reach and decide,
 * comparable to that sweep's own cost, and for the same reason not worth paying on
 * every mobile run too.
 */
test.use({ storageState: COACH_STORAGE_STATE });
test.setTimeout(60_000);

test("a set reaching games-all is decided by a tiebreak", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E breaker ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker, "Short Sets");

  const score = page.getByRole("table", { name: "Score" });
  const trackedRow = score.getByRole("row").nth(0);
  const opponentRow = score.getByRole("row").nth(1);
  const games = () => trackedRow.getByRole("cell").nth(0);
  const call = () => trackedRow.getByRole("cell").nth(1);

  // Alternating three love games each way reaches the 3-3 games-all Short Sets
  // breaks at (state.ts's tiebreakAt: 3), in 24 points rather than the 6-6 a
  // full-length set would cost for the same coverage.
  for (let taken = 0; taken < 3; taken += 1) {
    await winGame(page, true);
    await winGame(page, false);
  }
  await expect(games()).toHaveText("3");
  // The breaker's own point count starts at 0 too, indistinguishable on its own
  // from a fresh game's "0" call — the assertion below, after two points, is what
  // actually proves this is breaker scoring rather than a seventh game.
  await expect(call()).toHaveText("0");

  await skipPoint(page, true);
  await skipPoint(page, true);
  await expect(call()).toHaveText("2"); // a raw breaker count, never a point-call label

  await skipPoint(page, true);
  await skipPoint(page, true);
  await skipPoint(page, true); // 5-0 wins the breaker (score.test.ts's own decided case)

  // Short Sets credits the breaker's winner four games, the loser three
  // (state.ts: gamesToWin: 4) — this format's version of "7-6".
  await expect(trackedRow.getByRole("cell").nth(0)).toHaveText("4");
  await expect(opponentRow.getByRole("cell").nth(0)).toHaveText("3");
});
