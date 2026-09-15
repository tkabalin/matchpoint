import { expect, test, type Page } from "@playwright/test";

import { createPlayer, matchIdNamed, matchResult, openHome, pointsOf } from "./api";
import {
  declareScore,
  endMatchAs,
  finishMatch,
  openCapture,
  startMatch,
  sweepMatch,
  tapOutMatch,
} from "./capture";
import { COACH_STORAGE_STATE } from "./coach";
import { readOutboxRows } from "./outbox";

/**
 * Whether a finished match's result reaches the server.
 *
 * capture.spec.ts covers the cheap end of this on every device; these are the
 * expensive and the corrected-match cases, so they run in one project. Neither
 * depends on a viewport: what decides them is `flushMatch` in features/sync/drain.ts.
 */
test.use({ storageState: COACH_STORAGE_STATE });

/**
 * Playing a match out takes 32 points even in the shortest format, each of them
 * two clicks, and the drain still has to settle afterwards.
 */
test.setTimeout(120_000);

/**
 * The whole journey, tapped: a match played to its end, completed from the result
 * screen, and read back off the server with the right winner.
 *
 * Every point is skipped rather than played through the court, because the court
 * has no uniform "the tracked player won this" tap: Ace on the return screen means
 * the opponent aced, so tapping it each time alternates the winner and the match
 * never ends.
 */
test("a match played to completion lands with its winner", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E swp ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker);
  // Best of three, six games a set, four points a game: 48 is the ceiling a
  // deuce-free sweep cannot reach, not a target.
  await sweepMatch(page, 60);
  await finishMatch(page);

  const matchId = await matchIdNamed(page, marker);
  await expect.poll(() => matchResult(page, matchId), { timeout: 20_000 }).toBe("win");
  await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
});

/**
 * #269, now fixed and guarded here: a match the coach corrected still lands its
 * result. An undo queues an `eventDelete` row and a score correction a
 * `checkpoint` one, and while neither had an endpoint to drain to, `flushMatch`
 * held the outcome PATCH back behind them and fenced that match's result out of
 * the server for good, its points landing all the while.
 */
const CORRECTIONS = [
  {
    what: "an undo",
    async apply(page: Page) {
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    },
  },
  {
    what: "a corrected score",
    async apply(page: Page) {
      await declareScore(page, [{ name: "Tracked", set: 1, games: 2 }]);
    },
  },
] as const;

for (const correction of CORRECTIONS) {
  test(`a match with ${correction.what} still lands its result`, async ({ page }) => {
    await openHome(page);
    const playerId = await createPlayer(page, { firstName: "Tracked" });
    const marker = `E2E fix ${crypto.randomUUID().slice(0, 8)}`;

    await openCapture(page, playerId);
    await tapOutMatch(page, marker, ["ace", "ace"]);
    await correction.apply(page);
    // Retired rather than played out: what is under test is the correction's own
    // row, and a retirement queues the outcome in three taps from wherever the
    // correction left the screen.
    await endMatchAs(page, /Retirement/, "Tracked");

    // The points were unaffected by the old gate, so they are what says the drain
    // ran at all, independently of the outcome this spec is actually here for.
    const matchId = await matchIdNamed(page, marker);
    await expect.poll(() => pointsOf(page, matchId), { timeout: 20_000 }).not.toHaveLength(0);

    // Short, because a green run pays it every time: the outcome either goes out
    // on the next sweep or never does.
    await expect.poll(() => matchResult(page, matchId), { timeout: 8_000 }).toBe("win");
  });
}
