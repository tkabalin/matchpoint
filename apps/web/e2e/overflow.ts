import { expect, type Page } from "@playwright/test";

import { Point } from "@/features/capture/point";
import { toPointCreate } from "@/features/sync/point-payload";

import { createPlayer, postJson } from "./api";

// STORAGE_KEY in src/lib/last-viewed-player.ts. A literal rather than an import,
// matching outbox.ts's own reasoning for OUTBOX_DB: this file only needs the one
// string, not the module's read/write logic, and importing it would pull in
// nothing extra here but the constant is simple enough not to warrant it.
const LAST_VIEWED_PLAYER_STORAGE_KEY = "matchpoint:last-viewed-player";

/**
 * Every element the mobile-WebKit `min-w-0` trap can hit: walks up from each
 * element to its nearest ancestor that actually clips (`overflow-x: hidden` or
 * `clip`), skipping past a genuine scroller (`auto`/`scroll` — those are meant to
 * hold wide content), and reports any element whose box escapes that clipper's
 * right edge. See `.claude/rules/web.md`'s horizontal-scroll rule for why this
 * clips silently rather than scrolling the page: `Card` and the match card's own
 * `Item` both carry `overflow-hidden`, on top of the global `overflow-x: hidden`
 * backstop on `html`/`body`.
 */
export function overflowingNodes(page: Page): Promise<
  {
    over: number;
    tag: string;
    cls: string;
    text: string | null;
    clipperTag: string;
    clipperCls: string;
  }[]
> {
  return page.evaluate(() => {
    // el.className is an SVGAnimatedString (not a plain string) on an SVG
    // element, which JSON.stringify renders as "{}" — getAttribute is the
    // one accessor that returns the class list as a string on every element.
    const classOf = (el: Element) => el.getAttribute("class") ?? "";
    const clips = (el: Element) => ["hidden", "clip"].includes(getComputedStyle(el).overflowX);
    const out: {
      over: number;
      tag: string;
      cls: string;
      text: string | null;
      clipperTag: string;
      clipperCls: string;
    }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      let clipper = el.parentElement;
      while (clipper && getComputedStyle(clipper).overflowX === "visible") {
        clipper = clipper.parentElement;
      }
      if (!clipper || !clips(clipper)) continue; // a real scroller, not a clip: not a bug
      const elementRect = el.getBoundingClientRect();
      const clipperRect = clipper.getBoundingClientRect();
      const over = Math.round(elementRect.right - clipperRect.right);
      if (over > 1) {
        out.push({
          over,
          tag: el.tagName,
          cls: classOf(el),
          text: el.textContent?.slice(0, 40) ?? null,
          clipperTag: clipper.tagName,
          clipperCls: classOf(clipper),
        });
      }
    }
    return out.sort((a, b) => b.over - a.over);
  });
}

/** A player with no matches at all — `attention.ts` hard-flags this as "No
 *  matches logged yet", which is enough on its own to make Home render an
 *  `AttentionCard`. Deliberately a long, unbroken name: this is the input the
 *  `min-w-0` bug needs to actually show up. */
export function seedAttentionFlagPlayer(page: Page): Promise<string> {
  return createPlayer(page, {
    firstName: "Konstantinos-Maximilian",
    lastName: "Papadopoulos-Wolfeschlegelstein",
  });
}

/**
 * A player with one in-progress match against a long-named opponent, its points
 * spanning three sets so the momentum strip is as wide as a real one gets. Left
 * without a `result`: `ingest_points` refuses a batch against a completed match,
 * and an in-progress match still renders full sets/games, so there is no reason
 * to complete it here.
 */
export async function seedMatchWithMomentumStrip(page: Page): Promise<string> {
  const playerId = await createPlayer(page, {
    firstName: "Jean-Baptiste",
    lastName: "Grosjean-Vandermeulen",
  });

  const matchResponse = await postJson(page, "/api/matches", {
    player_id: playerId,
    opponent_name: "Wojciech Szczepański-Kowalczyk",
    played_on: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    surface: "hard",
    scoring_system: "traditional",
  });
  expect(matchResponse.status()).toBe(201);
  const matchId = ((await matchResponse.json()) as { id: string }).id;

  // One point per game is enough: deriveSets (match-card.tsx) only reads
  // is_game_end/is_set_end, never counts points within a game.
  const points = [];
  let sequence = 0;
  for (let setNumber = 1; setNumber <= 3; setNumber++) {
    for (let gameNumber = 1; gameNumber <= 6; gameNumber++) {
      const isLastGameOfSet = gameNumber === 6;
      points.push(
        Point.create({
          id: crypto.randomUUID(),
          matchId,
          timestamp: Date.now(),
          sequence: sequence++,
          // Every point an ace TRACKED served and therefore won: the momentum
          // strip's width is what this seed exists to exercise, not the mix of
          // who won which game.
          server: "TRACKED",
          courtSide: gameNumber % 2 === 0 ? "DEUCE" : "AD",
          won: true,
          context: {
            setNumber,
            gameNumber,
            inTiebreak: false,
            isBreakPoint: false,
            isGamePoint: false,
            isGameEnd: true,
            isSetPoint: isLastGameOfSet,
            isSetEnd: isLastGameOfSet,
            isMatchPoint: false,
          },
          serves: [{ number: 1, outcome: "ACE", location: null }],
          returnOutcome: null,
          endReason: "ACE",
          unusualReason: null,
          note: null,
          wing: null,
          shotType: null,
          ballIn: null,
          ballLocation: null,
          rallyLengthBucket: null,
        }),
      );
    }
  }

  const ingestResponse = await postJson(page, `/api/matches/${matchId}/points`, {
    device_id: crypto.randomUUID(),
    points: points.map(toPointCreate),
  });
  expect(ingestResponse.status()).toBe(200);

  return playerId;
}

/** Marks a player as the one Home's "Continue with" card shows, the same way
 *  visiting their profile does (`setLastViewedPlayerId`) — done directly rather
 *  than by navigating there first, since the seed only needs the storage side
 *  effect, not the visit itself. */
export async function markLastViewed(page: Page, playerId: string): Promise<void> {
  await page.addInitScript(
    ({ key, playerId: id }) => {
      localStorage.setItem(key, JSON.stringify({ playerId: id, viewedAt: Date.now() }));
    },
    { key: LAST_VIEWED_PLAYER_STORAGE_KEY, playerId },
  );
}
