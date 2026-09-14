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
 * expensive and the failing cases, so they run in one project. Neither depends on
 * a viewport: what decides them is `flushMatch` in features/sync/drain.ts.
 *
 * ---------------------------------------------------------------------------
 * IF YOU ARE HERE BECAUSE CI WENT RED WITH "Expected to fail, but passed":
 * that is the intended signal, not a broken test. #269 is now fixed. The only
 * change to make is to DELETE the `test.fail(...)` call in the test named in the
 * failure. Do not skip it, delete it, rewrite it, weaken its assertions, or
 * widen its timeouts — they are what prove the fix actually works.
 * ---------------------------------------------------------------------------
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
 * #269: a match the coach corrected never has its result synced.
 *
 * `checkpoint` and `eventDelete` rows have no endpoint to go to, so the drain
 * leaves them pending, and `flushMatch` only sends the outcome PATCH when every
 * one of a match's rows is sendable. One undo, or one score correction, therefore
 * fences that match's result out of the server permanently, while its points
 * still land and still feed the serve and rally figures.
 *
 * Marked `test.fail()` rather than left unwritten: it documents the defect, costs
 * a few seconds a run, and turns red the moment #269 removes the gate.
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

    // The points are unaffected by the gate, so they are what says the drain ran
    // at all; waiting on the outbox instead would be waiting on a state the fix
    // changes, and this spec has to keep failing for its own reason until then.
    const matchId = await matchIdNamed(page, marker);
    await expect.poll(() => pointsOf(page, matchId), { timeout: 20_000 }).not.toHaveLength(0);

    // Short, because a green run pays it every time: the outcome either goes out
    // on the next sweep or never does.
    await expect.poll(() => matchResult(page, matchId), { timeout: 8_000 }).toBe("win");
  });
}
