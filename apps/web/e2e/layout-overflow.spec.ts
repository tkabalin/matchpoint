import { expect, test } from "@playwright/test";

import { COACH_STORAGE_STATE } from "./coach";
import {
  markLastViewed,
  overflowingNodes,
  seedAttentionFlagPlayer,
  seedMatchWithMomentumStrip,
} from "./overflow";

/**
 * Guards against the CSS Grid "blowout" bug that clipped Home and Matches on
 * mobile: `AuthenticatedLayout`'s grid had a row track (`grid-rows-[...]`) but
 * no column track, so its one implicit column defaulted to a bare `auto`
 * track — sized off a long-name descendant's max-content/max-width rather
 * than the viewport — instead of Tailwind's usual `minmax(0, 1fr)`. The
 * global `overflow-x: hidden` backstop (app.css) then clipped the excess
 * silently rather than scrolling the page, which is why this needs a real
 * roster with long names to catch: a short-named seed never reaches the
 * width that triggers it. See .claude/rules/web.md's horizontal-scroll rule.
 *
 * A Vitest/jsdom test cannot catch this class of bug: jsdom has no layout
 * engine, so getBoundingClientRect() always returns zeros and this assertion
 * would trivially pass forever.
 */
test.use({ storageState: COACH_STORAGE_STATE });

test("Home never clips card content, even with a long player name", async ({ page }) => {
  await seedAttentionFlagPlayer(page);
  const momentumPlayerId = await seedMatchWithMomentumStrip(page);
  await markLastViewed(page, momentumPlayerId);

  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const offenders = await overflowingNodes(page);
  expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
});

test("Matches never clips a card's content, even with long player and opponent names", async ({
  page,
}) => {
  await seedMatchWithMomentumStrip(page);

  await page.goto("/matches");
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible();
  // MatchCard gates its points query on useInView; the seeded card should
  // already be on screen on a fresh visit, but scroll to be sure. .first():
  // the shared coach account may carry more than one seeded match by now.
  await page.getByText("Vandermeulen", { exact: false }).first().scrollIntoViewIfNeeded();

  const offenders = await overflowingNodes(page);
  expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
});
