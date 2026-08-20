import { expect, test, type Page } from "@playwright/test";

import { COACH_STORAGE_STATE } from "./coach";
import { readVerificationCode } from "./mail";
import {
  buildMatchRow,
  deleteOutboxRow,
  readOutboxRows,
  seedOutbox,
  waitForServiceWorkerControl,
} from "./outbox";

/**
 * The offline round trip (#118): capture with no connection, survive a reload,
 * flush exactly once when connectivity returns. Runs only in the offline-chromium
 * project, against the production build, because the service worker these specs
 * lean on does not exist under `vite dev`.
 *
 * Rows are seeded straight into the outbox rather than through capture-screen
 * taps, which don't exist yet; upgrade the seeding once that UI lands. Only
 * match rows are seeded: the point mapper throws until #210 gives the capture
 * model its score stamps, so the point half of the round trip waits there too.
 */

/** OWNER_KEY in src/lib/local-data.ts: whose rows a drain flushes. */
const OWNER_KEY = "matchpoint:local-data-owner";

/**
 * The origin the run is against, read from the project rather than spelled out:
 * a port changed in the config would otherwise turn every write below into a 403
 * whose message says nothing about where the mismatch came from.
 */
function originUnderTest(): string {
  return test.info().project.use.baseURL!;
}

/**
 * POSTs as the app itself would. The API refuses a write whose Origin is not
 * its own (csrf.py), and Playwright's request context, unlike a browser page,
 * sends no Origin at all unless told to.
 */
function postJson(page: Page, url: string, data: unknown) {
  return page.request.post(url, { data, headers: { origin: originUnderTest() } });
}

/** The coach id the visit to an authenticated route just recorded. */
async function recordedOwner(page: Page): Promise<string> {
  const owner = await page.evaluate((key) => localStorage.getItem(key), OWNER_KEY);
  expect(owner, "no owner recorded; did the authenticated route load?").not.toBeNull();
  return owner as string;
}

/** A player of this coach's for seeded matches to track, via the live API. */
async function createPlayer(page: Page): Promise<string> {
  const response = await postJson(page, "/api/players", {
    first_name: "Offline",
    last_name: `Player ${Date.now()}`,
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** How many of the coach's matches carry this marker name: the exactly-once probe. */
async function matchesNamed(page: Page, opponentName: string): Promise<number> {
  const response = await page.request.get("/api/matches");
  expect(response.status()).toBe(200);
  const matches = (await response.json()) as { opponent_name: string | null }[];
  return matches.filter((match) => match.opponent_name === opponentName).length;
}

async function matchStatus(page: Page, matchId: string): Promise<number> {
  return (await page.request.get(`/api/matches/${matchId}`)).status();
}

/** Signed-in load that the drain and the seeds both need to have happened. */
async function openHome(page: Page): Promise<void> {
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("with the service worker", () => {
  test.use({ storageState: COACH_STORAGE_STATE });

  test("matches captured offline survive a reload and sync exactly once", async ({ page }) => {
    await openHome(page);
    await waitForServiceWorkerControl(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    await page.context().setOffline(true);
    const marker = `E2E offline ${crypto.randomUUID()}`;
    const first = buildMatchRow({ coachId, playerId, opponentName: marker });
    const second = buildMatchRow({ coachId, playerId, opponentName: marker });
    await seedOutbox(page, [first, second]);

    // Reload while still offline: the shell comes from the precache, the rows
    // from IndexedDB. This is the durability half of the milestone.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await readOutboxRows(page)).toHaveLength(2);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, first.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => matchStatus(page, second.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // Exactly once: a duplicate under a fresh server id would still carry the marker.
    expect(await matchesNamed(page, marker)).toBe(2);
  });

  test("the app cold-starts offline from the precache", async ({ page }) => {
    await openHome(page);
    await waitForServiceWorkerControl(page);

    // A closed tab, not a reload: the next page has nothing but the service
    // worker and IndexedDB, which is a court with no signal at app open.
    await page.close();
    const context = page.context();
    await context.setOffline(true);
    const reopened = await context.newPage();

    // Two direct navigations, not client-side ones: each is a request the
    // navigateFallback config answers with the cached shell, which is the one
    // piece of the PWA config only a cold start exercises.
    await reopened.goto("/home");
    await expect(reopened.getByRole("heading", { level: 1 })).toBeVisible();
    await reopened.goto("/players");
    // Named, unlike /home above, whose heading is the coach's own and so needs a
    // profile the cache may not hold: it is what tells the shell apart from any
    // other page the fallback could have answered with.
    await expect(reopened.getByRole("heading", { name: "Players", level: 1 })).toBeVisible();
  });
});

test.describe("drain behaviour", () => {
  // page.route cannot see requests a service worker handles, so the specs that
  // intercept the wire run without one; nothing here reloads offline.
  test.use({ storageState: COACH_STORAGE_STATE, serviceWorkers: "block" });

  test("a flush the server ingested but the client lost converges to one match", async ({
    page,
  }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    await page.context().setOffline(true);
    const marker = `E2E interrupted ${crypto.randomUUID()}`;
    const row = buildMatchRow({ coachId, playerId, opponentName: marker });
    await seedOutbox(page, [row]);

    // First attempt only: forward the request so the server ingests it, then
    // abort the response, so the client sees a network failure and retries.
    let interceptedStatus: number | null = null;
    await page.route("**/api/matches", async (route) => {
      if (route.request().method() !== "POST" || interceptedStatus !== null) {
        return route.continue();
      }
      const response = await route.fetch();
      interceptedStatus = response.status();
      await route.abort("failed");
    });

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, row.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // The interruption really happened after ingestion, and the retry that
    // converged went through the server's insert-or-ignore, not a second write.
    expect(interceptedStatus).toBe(201);
    expect(await matchesNamed(page, marker)).toBe(1);
  });

  test("a match deleted from the outbox before sync never reaches the server", async ({ page }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    await page.context().setOffline(true);
    const marker = `E2E undone ${crypto.randomUUID()}`;
    const kept = buildMatchRow({ coachId, playerId, opponentName: marker });
    const undone = buildMatchRow({ coachId, playerId, opponentName: marker });
    await seedOutbox(page, [kept, undone]);
    await deleteOutboxRow(page, undone.id);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, kept.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // The queue is fully drained, so a 404 now is permanent, not a not-yet.
    expect(await matchStatus(page, undone.matchId)).toBe(404);
    expect(await matchesNamed(page, marker)).toBe(1);
  });

  test("two tabs sharing the queue flush it exactly once", async ({ page }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);
    // The second tab: same context, so the same IndexedDB and the same real
    // Web Locks arbitration the unit suite only ever stubs.
    const second = await page.context().newPage();
    await second.goto("/home");
    await expect(second.getByRole("heading", { level: 1 })).toBeVisible();

    let posts = 0;
    await page.context().route("**/api/matches", async (route) => {
      if (route.request().method() === "POST") posts += 1;
      await route.continue();
    });

    await page.context().setOffline(true);
    const marker = `E2E two tabs ${crypto.randomUUID()}`;
    const row = buildMatchRow({ coachId, playerId, opponentName: marker });
    await seedOutbox(page, [row]);

    // Both tabs hear connectivity return and both schedule a drain; the lock
    // must collapse the race to a single sender.
    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, row.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    expect(posts).toBe(1);
    expect(await matchesNamed(page, marker)).toBe(1);
  });
});

test.describe("a session revoked mid-queue", () => {
  // Its own coach, signed up through the live API: this spec kills the session it
  // runs as, which must never be the one every other signed-in spec shares. No
  // service worker, so the drain's POST is a page request the spec can wait on.
  test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

  test("keeps the outbox, and signing back in flushes it", async ({ page, playwright }) => {
    const email = `offline-401-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
    const password = "drop-volley-lantern-83";
    const displayName = "Revoked Coach";

    // The sign-up journey as requests rather than form fills: the form is
    // auth.setup.ts's subject, and this spec only needs the account.
    expect((await postJson(page, "/api/auth/request-otp", { email })).ok()).toBe(true);
    const verified = await postJson(page, "/api/auth/verify-otp", {
      email,
      otp: readVerificationCode(email),
    });
    expect(verified.ok()).toBe(true);
    const created = await postJson(page, "/api/coaches", {
      email,
      password,
      display_name: displayName,
    });
    expect(created.status()).toBe(201);
    expect((await postJson(page, "/api/auth/login", { email, password })).ok()).toBe(true);

    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    await page.context().setOffline(true);
    const marker = `E2E revoked ${crypto.randomUUID()}`;
    const row = buildMatchRow({ coachId, playerId, opponentName: marker });
    await seedOutbox(page, [row]);

    // Revoke server-side from a copy of the cookie jar, so the page keeps
    // presenting a session the server has already ended.
    const origin = originUnderTest();
    const twin = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin },
      storageState: await page.context().storageState(),
    });
    expect((await twin.post("/api/auth/logout")).ok()).toBe(true);
    await twin.dispose();

    // The drain must try, hit the 401, and halt with the queue intact: nothing
    // purged, nothing parked. A revoked session must never cost a match. Waiting
    // on the refusal, not on the attempt: a 500 leaves the queue standing too, so
    // only the status tells the halt this covers from an ordinary retry.
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/matches",
      { timeout: 20_000 },
    );
    await page.context().setOffline(false);
    expect((await refused).status()).toBe(401);
    const rows = await readOutboxRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row.id, status: "pending" });

    // Through the form, not the API: sign-in is the only caller of
    // purgeIfCoachChanged, and its same-coach branch is what has to leave the
    // queue standing. The reload after it is the drain's launch trigger.
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(
      page.getByRole("heading", { name: `Coach ${displayName}`, level: 1 }),
    ).toBeVisible();
    await page.reload();
    await expect.poll(() => matchStatus(page, row.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    expect(await matchesNamed(page, marker)).toBe(1);
  });
});
