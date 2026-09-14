import { expect, test } from "@playwright/test";

import { createPlayer, matchIdNamed, matchResult, openHome, pointsOf } from "./api";
import {
  declareScore,
  endMatchAs,
  openCapture,
  skipPoint,
  startMatch,
  tapDetailedPoint,
  tapOutMatch,
} from "./capture";
import { COACH_STORAGE_STATE } from "./coach";
import { readLoggedEvents, readOutboxRows } from "./outbox";

/**
 * Capturing a match and having the server agree with what was captured.
 *
 * offline.spec.ts proves the round trip with the connection down, and does it in
 * one project against the production build. These are the online cases, and they
 * run on all three device projects because capture is used phone in hand: this is
 * the only place the hand-rolled opponent combobox, the court's own hit-testing
 * and a real drain are exercised on a touch viewport or on WebKit at all.
 */
test.use({ storageState: COACH_STORAGE_STATE });

// A drain waits out a 1s debounce and can sit on a 1, 2, 4, 8s backoff, and these
// specs poll for server state twice over. The projects here take the config's
// 30s default, which two such polls can exhaust while everything behaves.
test.setTimeout(60_000);

/**
 * A match ended by retirement is the cheapest proof that an outcome ever reaches
 * the server: `endMatch` reaches `finish()` without queueing an event, so the
 * match's rows are the create and the outcome alone, both of which the drain has
 * a request for. It also covers a match that ends with no points at all, which
 * every other spec in the suite has at least one of.
 */
test("a match ended by retirement lands its result on the server", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E ret ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker);
  await endMatchAs(page, /Retirement/, "Tracked");

  // The opponent retired, so the match is the tracked player's.
  const matchId = await matchIdNamed(page, marker);
  await expect.poll(() => matchResult(page, matchId), { timeout: 20_000 }).toBe("win");
  await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
});

/**
 * The one point in the suite recorded in full. Every other spec taps an ace or a
 * point seen only for its winner, so nothing else fills the analytics columns,
 * and nothing else goes through the court's own hit-testing — jsdom has no
 * geometry, so `court-geometry.ts` is unit-tested against numbers rather than
 * against a tap landing where the coach aimed it.
 */
test("a point recorded in full reaches the server with every field", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E pt ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker);
  await tapDetailedPoint(page, marker);

  const matchId = await matchIdNamed(page, marker);
  await expect.poll(() => pointsOf(page, matchId), { timeout: 20_000 }).toHaveLength(1);
  const [point] = await pointsOf(page, matchId);
  expect(point).toMatchObject({
    won: true,
    serve1_outcome: "in",
    serve1_box: "deuce",
    end_reason: "forced",
    rally_length_bucket: "b2",
    wing: "forehand",
    shot_type: "drive",
    ball_depth: "deep",
  });
});

/**
 * Reopening a match the device was already capturing, by the route a coach takes:
 * the banner on Home, not the capture URL. offline.spec.ts's own resume goes
 * straight back to /new-match/:playerId, so nothing until now has driven
 * `in-progress-banner.tsx` or the fold behind it (#229).
 *
 * The score is declared before the first point so the restored fold covers a
 * checkpoint as well as a point — `resume.ts` branches on the event kind, and a
 * log of points alone never takes the other branch.
 */
test("a match resumed from the banner comes back at the same score", async ({ page, context }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E res ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await startMatch(page, marker);
  // Declared on an empty log, the one state the sheet accepts without checking the
  // score against a serving order it has not seen any points establish yet.
  await declareScore(page, [
    { name: "Tracked", set: 1, games: 3 },
    { name: marker, set: 1, games: 1 },
  ]);
  // Through the header rather than the court: which screen a declared score lands
  // on depends on whose serve the checkpoint implies, and Skip point is on both.
  // A games cell declared rather than played carries a "(not fully recorded)"
  // suffix for screen readers, so this matches the figure rather than the cell.
  const score = page.getByRole("table", { name: "Score" });
  await expect(score.getByRole("cell", { name: /^3\b/ })).toBeVisible();
  await skipPoint(page, true);

  // The match log, not the scoreboard and not the queue: capture's writes are
  // fire-and-forget, so the score updates before the rows land, and this spec runs
  // online, so the queue is drained out from under a count as it goes. The log is
  // what the reopened tab folds, and it is not emptied by a drain.
  const matchId = await matchIdNamed(page, marker);
  await expect.poll(() => readLoggedEvents(page, matchId), { timeout: 20_000 }).toHaveLength(2);

  const reopened = await context.newPage();
  await page.close();
  await openHome(reopened);
  // Named for the player and the resume both: Home carries other specs' players
  // under the same name (the coach is shared for the whole run), and a second
  // resume affordance of its own in PrimaryMatchAction, whose label names neither.
  await reopened.getByRole("link", { name: /Tracked.*Resume/ }).click();

  const restored = reopened.getByRole("table", { name: "Score" });
  await expect(restored.getByRole("cell", { name: /^3\b/ })).toBeVisible();
  await expect(restored.getByRole("cell", { name: "15", exact: true })).toBeVisible();
});

/**
 * The opponent field is a combobox this project hand-rolled after the native
 * datalist proved unstyleable, and offline.spec.ts fills it only in the one
 * Chromium project. This is the same fill on a touch viewport and on WebKit.
 */
test("the opponent combobox starts a match on this device", async ({ page }) => {
  await openHome(page);
  const playerId = await createPlayer(page, { firstName: "Tracked" });
  const marker = `E2E box ${crypto.randomUUID().slice(0, 8)}`;

  await openCapture(page, playerId);
  await tapOutMatch(page, marker, ["ace"]);
  await matchIdNamed(page, marker);
});
