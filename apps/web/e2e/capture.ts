import { expect, type Page } from "@playwright/test";

import { readOutboxRows } from "./outbox";

/**
 * Driving the capture screens from a spec.
 *
 * Extracted from offline.spec.ts so more than one spec file can tap out a match.
 * Everything here goes through the real screens rather than the outbox: the tap
 * is what the app's own `append` reacts to, and it is the half of the round trip
 * a seeded row cannot prove.
 */

/**
 * Opens the capture screen for this player and waits for the setup form. Online,
 * because the screen fetches the player before it renders; a spec that must hold
 * the rows back goes offline once the form is showing, and the taps that follow
 * need no network at all (.claude/rules/web-capture.md).
 */
export async function openCapture(page: Page, playerId: string): Promise<void> {
  await page.goto(`/new-match/${playerId}`);
  await expect(page.getByRole("heading", { name: "Match", level: 1 })).toBeVisible();
}

/**
 * Names the opponent and starts the match, leaving the first serve on screen.
 *
 * Opponent is a hand-rolled combobox (see match-setup-screen.tsx), given an
 * explicit role="combobox" rather than "textbox".
 */
export async function startMatch(page: Page, opponentName: string): Promise<void> {
  await page.getByRole("combobox", { name: "Opponent" }).fill(opponentName);
  await page.getByRole("button", { name: "Start match" }).click();
  await expect(page.getByRole("heading", { name: "1st Serve" })).toBeVisible();
}

/**
 * What a coach records in one point: an ace, the one-tap point, or a point seen
 * only for its winner, which is the shape #210 opened the API to (an unwatched
 * serve and an unwatched ending, both null on the wire).
 */
export type Tap = "ace" | "winner only";

/**
 * Starts the match against this opponent and taps out the given points, which is
 * how rows reach the outbox in production: through `append`, whose Dexie write is
 * the one the drain's liveQuery trigger observes. Every tap is a point the player
 * wins, so the scoreboard reading 15, 30, 40 is the signal that the point committed
 * and its row was queued; three points is therefore the most a spec taps out.
 *
 * `sweepMatch` below is what a spec reaches for when it needs more than that.
 */
export async function tapOutMatch(
  page: Page,
  opponentName: string,
  taps: readonly Tap[],
): Promise<void> {
  await startMatch(page, opponentName);
  const score = page.getByRole("table", { name: "Score" });
  for (const [index, tap] of taps.entries()) {
    if (tap === "ace") {
      await page.getByRole("button", { name: "Ace" }).click();
    } else {
      await page.getByRole("button", { name: "Didn't see" }).click();
      await expect(page.getByRole("heading", { name: "Final ball" })).toBeVisible();
      await page.getByRole("button", { name: "Didn't see" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Win/ }).click();
    }
    await expect(score.getByText(["15", "30", "40"][index]!, { exact: true })).toBeVisible();
  }
}

/** The match row and point rows the taps just queued, in enqueue order. */
export async function queuedByTaps(page: Page): Promise<{ matchId: string; pointIds: string[] }> {
  const rows = await readOutboxRows(page);
  const match = rows.find((row) => row.kind === "match");
  expect(match, "no match row queued; did the taps commit a point?").toBeDefined();
  return {
    matchId: match!.matchId,
    pointIds: rows.filter((row) => row.kind === "point").map((row) => row.id),
  };
}

/**
 * One point recorded in full: serve box, where the ball finished, how long the
 * rally ran, how it ended, and the shot that ended it. Every other helper here
 * records a point the coach only partly saw, so this is the one path that fills
 * the analytics columns, and the only one that goes through CourtDiagram's real
 * hit-testing rather than a button beside the court.
 *
 * The final ball lands on the opponent's half, which is what makes it the tracked
 * player's point.
 */
export async function tapDetailedPoint(page: Page, opponentName: string): Promise<void> {
  await page.getByRole("button", { name: "Deuce service box" }).click();
  await expect(page.getByRole("heading", { name: "Final ball" })).toBeVisible();
  // Named for the opponent, not the zone alone: both halves of the court carry a
  // deuce-deep zone, and which half the ball finished on is what decides the point.
  await page.getByRole("button", { name: `${opponentName}: deuce deep` }).click();
  await expect(page.getByRole("heading", { name: "Rally length" })).toBeVisible();
  await page.getByRole("button", { name: "3-5", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How it ended" })).toBeVisible();
  await page.getByRole("button", { name: /^Forced/ }).click();
  await expect(page.getByRole("heading", { name: "Final shot" })).toBeVisible();
  await page.getByRole("button", { name: "Forehand drive" }).click();
  await expect(page.getByRole("heading", { name: "1st Serve" })).toBeVisible();
}

/**
 * The header's winner-only path: two clicks, and the only uniform way to play a
 * match out. The court buttons cannot do it — "Ace" on the return screen means
 * the opponent aced, so tapping it every time alternates the winner and the
 * match never ends.
 */
export async function skipPoint(page: Page, won: boolean): Promise<void> {
  await page.getByRole("button", { name: "Skip point" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: won ? /^Win/ : /^Loss/ })
    .click();
}

/**
 * Plays the match out to the tracked player, one skipped point at a time, and
 * stops as soon as the result screen appears.
 *
 * Bounded rather than looping until the screen changes: the cheapest format still
 * needs 32 points, and a scoring bug would otherwise hang the spec rather than
 * fail it.
 */
export async function sweepMatch(page: Page, maxPoints: number): Promise<void> {
  const finished = page.getByRole("button", { name: "Finish match" });
  for (let taken = 0; taken < maxPoints; taken += 1) {
    if (await finished.isVisible()) return;
    await skipPoint(page, true);
  }
  await expect(finished, `match did not finish inside ${String(maxPoints)} points`).toBeVisible();
}

/**
 * States the score outright, the way a coach who missed games does, and queues a
 * checkpoint rather than inventing the points that would add up to it.
 *
 * Only safe on an empty log, which is where `validateCheckpoint` short-circuits
 * (score.ts's `!hasEvents`). Against a log with events the sheet cross-checks the
 * declared score against a serving-order chip seeded from the pre-edit board, and
 * refuses anything that disagrees.
 */
export async function declareScore(
  page: Page,
  cells: readonly { name: string; set: number; games: number }[],
): Promise<void> {
  await page.getByRole("button", { name: "Edit score" }).click();
  for (const cell of cells) {
    await page
      .getByRole("spinbutton", { name: `${cell.name} set ${String(cell.set)} games` })
      .fill(String(cell.games));
  }
  await page.getByRole("button", { name: "Set score" }).click();
}

/**
 * Ends the match early, awarding it to `winnerName`. Reaches `finish()` without
 * queueing an event, so the match's rows are the create and the outcome alone.
 */
export async function endMatchAs(
  page: Page,
  reason: RegExp,
  winnerName: string | RegExp,
): Promise<void> {
  await page.getByRole("button", { name: "Edit score" }).click();
  await page.getByRole("button", { name: "End match" }).click();
  await page.getByRole("radio", { name: reason }).click();
  await page
    .getByRole("group", { name: "Match awarded to" })
    .getByRole("button", { name: winnerName })
    .click();
  await page.getByRole("button", { name: "Confirm end of match" }).click();
}

/** Leaves the result screen, which is what completes the match (finishAndLeave). */
export async function finishMatch(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Finish match" }).click();
}
