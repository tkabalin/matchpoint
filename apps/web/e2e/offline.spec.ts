import { expect, test, type Page } from "@playwright/test";

import {
  completeMatchOnServer,
  createPlayer,
  deletePlayer,
  matchIdNamed,
  matchStatus,
  matchesNamed,
  openHome,
  pointsOf,
  postJson,
  recordedOwner,
  signUpCoach,
  originUnderTest,
} from "./api";
import { openCapture, queuedByTaps, tapOutMatch } from "./capture";
import { COACH_STORAGE_STATE } from "./coach";
import {
  buildMatchRow,
  buildPointRow,
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
 * Rows reach the outbox the way a coach's do, through the setup and capture
 * screens (tapOutMatch below), so the suite proves the round trip from the tap
 * rather than from the queue. Four specs seed the outbox directly instead, and
 * say why where they do: a refusal the screen cannot set up, and the point cases
 * in the last describe block that need hundreds of rows, a match completed on
 * the server, or a second match queued before the first one's points.
 *
 * What #217 leaves uncovered elsewhere: the capture-claim conflict (#197) has its
 * own spec, capture-claim.spec.ts, since it needs no service worker and runs
 * against the dev server rather than this file's production build. Retrying a
 * parked match by hand (#115) has its own spec too, in the "drain behaviour"
 * block below, alongside the park it retries.
 *
 * The helpers for talking to the API and for driving the capture screens live in
 * api.ts and capture.ts, shared with the specs that came after this one. What is
 * left below is this file's own: reading the persisted cache, and holding a
 * request open mid-flush.
 */

/**
 * Whether the persisted read cache holds this text yet: the database and store
 * src/lib/query-persist.ts names, holding one dehydrated snapshot of every
 * query. Saves are throttled, so a spec that goes offline without waiting on
 * this would be testing an empty snapshot.
 */
function persistedCacheHolds(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    async ({ dbName, storeName, needle }) => {
      // Listed before opened, for the reason seedOutbox gives: an unversioned
      // open would create an empty database that idb-keyval then cannot upgrade.
      if (!(await indexedDB.databases()).some((db) => db.name === dbName)) return false;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });
      try {
        if (!db.objectStoreNames.contains(storeName)) return false;
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(storeName).objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result as unknown[]);
          request.onerror = () => reject(request.error as Error);
        });
        return values.some((value) => JSON.stringify(value).includes(needle));
      } finally {
        db.close();
      }
    },
    { dbName: "matchpoint-query-cache", storeName: "cache", needle: text },
  );
}

/** A promise a route handler settles, so a spec can wait on the request itself. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test.describe("with the service worker", () => {
  test.use({ storageState: COACH_STORAGE_STATE });

  test("a match captured offline survives a reload and syncs exactly once", async ({ page }) => {
    await openHome(page);
    await waitForServiceWorkerControl(page);
    const playerId = await createPlayer(page);
    await openCapture(page, playerId);

    // Offline from the first tap: the court has no signal, and the queue has to
    // hold everything until it does.
    await page.context().setOffline(true);
    const marker = `E2E offline ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace", "winner only"]);
    const { matchId, pointIds } = await queuedByTaps(page);
    expect(pointIds).toHaveLength(2);

    // Away and back while still offline: the shell comes from the precache, the
    // rows from IndexedDB. This is the durability half of the milestone.
    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await readOutboxRows(page)).toHaveLength(3);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // Exactly once: a duplicate under a fresh server id would still carry the marker.
    expect(await matchesNamed(page, marker)).toBe(1);
    // Both points, in the order they were tapped, the unwatched one stored as such.
    const stored = await pointsOf(page, matchId);
    expect(stored.map((point) => point.id)).toEqual(pointIds);
    expect(stored[1]).toMatchObject({ serve1_outcome: null, end_reason: null });
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

  test("the roster and the match list render offline from the persisted cache", async ({
    page,
  }) => {
    await openHome(page);
    await waitForServiceWorkerControl(page);
    const stamp = crypto.randomUUID().slice(0, 8);
    const playerId = await createPlayer(page, {
      firstName: "Offline",
      lastName: `Cached ${stamp}`,
    });
    const marker = `E2E cached ${stamp}`;

    // Through the capture screen rather than a hand-written body, so this spec
    // holds no second copy of the create contract. Online throughout: the tap's
    // own write is the drain's trigger, so the match is on the server shortly.
    await openCapture(page, playerId);
    await tapOutMatch(page, marker, ["ace"]);
    await matchIdNamed(page, marker);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);

    // The one online visit (#116): a list has to have been read once for the
    // snapshot to carry it. Waited on rather than assumed after each screen,
    // because the save is throttled and a navigation drops the pending one: the
    // next boot then restores a snapshot the screen it came from is missing from.
    await page.goto("/players");
    // Scoped to the roster card's own header group, not a bare text match: this
    // same match is genuinely still in progress (tapOutMatch never finishes it),
    // so the in-progress banner now legitimately shows this player's name too, on
    // every authenticated screen including this one (#251) — a plain getByText
    // would match both and fail strict mode. The card's header carries its own
    // "... card" accessible name (`role="group"`, player-card.tsx) precisely so
    // it reads differently from the banner's bare-name link.
    await expect(page.getByRole("group", { name: `Offline Cached ${stamp}'s card` })).toBeVisible();
    await expect
      .poll(() => persistedCacheHolds(page, `Cached ${stamp}`), { timeout: 20_000 })
      .toBe(true);
    await page.goto("/matches");
    await expect(page.getByText(marker)).toBeVisible();
    await expect.poll(() => persistedCacheHolds(page, marker), { timeout: 20_000 }).toBe(true);

    // Both screens with the network down and nothing in memory: the API is not
    // in the precache, so the rows can only have come from the snapshot.
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByText(marker)).toBeVisible();
    await page.goto("/players");
    // Same scoping reason as the first assertion above.
    await expect(page.getByRole("group", { name: `Offline Cached ${stamp}'s card` })).toBeVisible();
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
    const playerId = await createPlayer(page);
    await openCapture(page, playerId);

    // First attempt only: forward the request so the server ingests it, then
    // abort the response, so the client sees a network failure and retries.
    // Installed before the tap, since online the tap's own write starts the drain.
    let interceptedStatus: number | null = null;
    await page.route("**/api/matches", async (route) => {
      if (route.request().method() !== "POST" || interceptedStatus !== null) {
        return route.continue();
      }
      const response = await route.fetch();
      interceptedStatus = response.status();
      await route.abort("failed");
    });

    const marker = `E2E interrupted ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace"]);
    const matchId = await matchIdNamed(page, marker);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // The interruption really happened after ingestion, and the retry that
    // converged went through the server's insert-or-ignore, not a second write.
    expect(interceptedStatus).toBe(201);
    expect(await matchesNamed(page, marker)).toBe(1);
    expect(await pointsOf(page, matchId)).toHaveLength(1);
  });

  test("a flush the tab died in the middle of drains on the next launch", async ({ page }) => {
    await openHome(page);
    const playerId = await createPlayer(page);
    await openCapture(page, playerId);

    // Forwarded, then never answered: the server has the match and the tab is
    // closed under a request the client is still waiting on, which is what a
    // phone reclaiming a backgrounded PWA does to a flush in flight.
    const sent = deferred<number>();
    await page.route("**/api/matches", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      sent.resolve(response.status());
      await new Promise(() => {});
    });

    const marker = `E2E killed ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace"]);
    expect(await sent.promise).toBe(201);
    const context = page.context();
    await page.close();

    // The relaunch, with its own flush held mid-air: the request arriving at all
    // is the launch trigger firing with nothing touched, and holding it is what
    // lets the queue be read before anything acknowledges the row.
    const relaunched = await context.newPage();
    const attempted = deferred();
    const release = deferred();
    let holding = false;
    await relaunched.route("**/api/matches", async (route) => {
      if (route.request().method() !== "POST" || holding) return route.continue();
      holding = true;
      attempted.resolve();
      await release.promise;
      await route.continue();
    });
    await relaunched.goto("/home");
    await attempted.promise;
    // The first tab died before it could remove the rows, so the match and its
    // point are still queued rather than parked or gone.
    const kept = await readOutboxRows(relaunched);
    expect(kept.map((row) => [row.kind, row.status])).toEqual([
      ["match", "pending"],
      ["point", "pending"],
    ]);

    release.resolve();
    await expect.poll(() => readOutboxRows(relaunched), { timeout: 20_000 }).toHaveLength(0);
    expect(await matchesNamed(relaunched, marker)).toBe(1);
    expect(await pointsOf(relaunched, kept[0]!.matchId)).toHaveLength(1);
  });

  test("a match the server refuses for good parks, and the queue behind it drains", async ({
    page,
  }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const doomedPlayerId = await createPlayer(page);
    const keptPlayerId = await createPlayer(page);
    // The player the queued match tracks is off the roster, which is a refusal no
    // retry can clear: nothing this device sends will make that create land.
    // Seeded rather than tapped: the capture screen cannot open for a player it
    // cannot fetch, and the second match has to queue behind the first offline.
    await deletePlayer(page, doomedPlayerId);

    await page.context().setOffline(true);
    const marker = `E2E parked ${crypto.randomUUID()}`;
    const doomed = buildMatchRow({ coachId, playerId: doomedPlayerId, opponentName: marker });
    const kept = buildMatchRow({ coachId, playerId: keptPlayerId, opponentName: marker });
    // Doomed first, so the park has to leave the sweep able to reach the match
    // behind it rather than ending the run.
    await seedOutbox(page, [doomed, kept]);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, kept.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(1);
    // Parked, not discarded, and carrying the refusal: the coach did not ask to
    // lose this match, so the row and its reason stay for the sync UI (#115).
    const parked = await readOutboxRows(page);
    expect(parked[0]).toMatchObject({
      id: doomed.id,
      status: "failed",
      failure: { status: 404, message: "Unknown player_id" },
    });
    expect(await matchStatus(page, doomed.matchId)).toBe(404);
    expect(await matchesNamed(page, marker)).toBe(1);
  });

  test("retrying a parked match from the sync status UI re-attempts it", async ({ page }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const doomedPlayerId = await createPlayer(page);
    const keptPlayerId = await createPlayer(page);
    await deletePlayer(page, doomedPlayerId);

    await page.context().setOffline(true);
    const marker = `E2E retry ${crypto.randomUUID()}`;
    const doomed = buildMatchRow({ coachId, playerId: doomedPlayerId, opponentName: marker });
    await seedOutbox(page, [doomed]);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, doomed.matchId), { timeout: 20_000 }).toBe(404);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(1);

    // The doomed match's own capture screen can never reopen (its player is gone),
    // so the retry has to be reachable from any live match: the sync status UI reads
    // the whole coach's queue, not just the one match on screen (#115).
    await openCapture(page, keptPlayerId);
    await tapOutMatch(page, "Another opponent", []);
    await page.getByText("1 point failed to sync").click();
    await expect(page.getByText("Unknown player_id")).toBeVisible();

    await page.getByRole("button", { name: "Retry" }).click();

    // The deleted player is still gone, so the retry re-parks with the same
    // reason — this proves the control exists and re-attempts, not that this
    // particular fixture can ever succeed.
    await expect
      .poll(() => readOutboxRows(page), { timeout: 20_000 })
      .toContainEqual(
        expect.objectContaining({
          id: doomed.id,
          status: "failed",
          failure: { status: 404, message: "Unknown player_id" },
        }),
      );
    expect(await matchStatus(page, doomed.matchId)).toBe(404);
  });

  test("a point deleted from the outbox before sync never reaches the server", async ({ page }) => {
    await openHome(page);
    const playerId = await createPlayer(page);
    await openCapture(page, playerId);

    // Offline, so the second point is still queued when it is taken back: undo
    // before sync means before the drain has had the row.
    await page.context().setOffline(true);
    const marker = `E2E undone ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace", "ace"]);
    const { matchId, pointIds } = await queuedByTaps(page);
    const [kept, undone] = pointIds;
    await deleteOutboxRow(page, undone!);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // The queue is fully drained, so a point absent now is gone for good, not not-yet.
    expect((await pointsOf(page, matchId)).map((point) => point.id)).toEqual([kept]);
    expect(await matchesNamed(page, marker)).toBe(1);
  });

  test("two tabs sharing the queue flush it exactly once", async ({ page }) => {
    await openHome(page);
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

    // Captured offline so that neither tab sends until both hear the same event.
    await openCapture(page, playerId);
    await page.context().setOffline(true);
    const marker = `E2E two tabs ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace"]);
    const { matchId } = await queuedByTaps(page);

    // Both tabs hear connectivity return and both schedule a drain; the lock
    // must collapse the race to a single sender.
    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    expect(posts).toBe(1);
    expect(await matchesNamed(page, marker)).toBe(1);
  });
});

test.describe("the point half of the round trip", () => {
  // Seeded rather than tapped: the first case needs more points than a spec should
  // tap out, and the other two need a match on the server or a second match before
  // its own points, which the capture screen has no reason to offer. Every seed
  // sits inside an offline bracket, so the reconnect is what drains it (see
  // seedOutbox). No service worker: the multi-batch case intercepts the wire.
  test.use({ storageState: COACH_STORAGE_STATE, serviceWorkers: "block" });

  test("a flush cut between two batches resumes at the second without repeating the first", async ({
    page,
  }) => {
    // 501 points through the queue, the wire and the database, twice over: the
    // heaviest spec in the suite, where the project's 90s timeout is sized for the
    // drain polls rather than for seeding and replaying a queue this long.
    test.slow();
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    // One more point than a batch holds (MAX_POINTS_PER_BATCH in drain.ts), so the
    // match flushes as a chunk of the ceiling and a chunk of one.
    await page.context().setOffline(true);
    const marker = `E2E batches ${crypto.randomUUID()}`;
    const match = buildMatchRow({ coachId, playerId, opponentName: marker });
    const points = Array.from({ length: 501 }, (_, sequence) =>
      buildPointRow({ coachId, matchId: match.matchId, sequence }),
    );
    await seedOutbox(page, [match, ...points]);

    // Connectivity goes as the second batch leaves: the first is acknowledged
    // and gone from the queue, the second never reaches the server.
    let batches = 0;
    const cut = deferred();
    await page.route("**/api/matches/*/points", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      batches += 1;
      if (batches !== 2) return route.continue();
      await page.context().setOffline(true);
      cut.resolve();
      await route.abort("failed");
    });

    await page.context().setOffline(false);
    // Waited on rather than read off the queue: the first batch's rows are gone the
    // moment it is acknowledged, so a spec watching the count alone could run past
    // the cut it is about, and then reconnect a connection that never dropped.
    await cut.promise;
    // The seam: exactly the second batch's row left, pending rather than parked,
    // since a dropped connection is a retry and not a refusal.
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(1);
    const remaining = await readOutboxRows(page);
    expect(remaining[0]).toMatchObject({ id: points[500]!.id, status: "pending" });
    expect(await pointsOf(page, match.matchId)).toHaveLength(500);

    await page.context().setOffline(false);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // Every point once, in enqueue order, with the first batch not sent again.
    const stored = await pointsOf(page, match.matchId);
    expect(stored.map((point) => point.id)).toEqual(points.map((point) => point.id));
    expect(stored.map((point) => point.sequence)).toEqual(points.map((_, index) => index));
  });

  test("a completed match parks its points and holds later ones, while another match drains", async ({
    page,
  }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);
    // Decided on the server before this device flushes, as a second device
    // finishing the match would leave it: ingest_points answers 409 from here on.
    const completedId = await completeMatchOnServer(page, playerId);

    await page.context().setOffline(true);
    const marker = `E2E fenced ${crypto.randomUUID()}`;
    const fenced = [0, 1].map((sequence) =>
      buildPointRow({ coachId, matchId: completedId, sequence }),
    );
    const kept = buildMatchRow({ coachId, playerId, opponentName: marker });
    const keptPoint = buildPointRow({ coachId, matchId: kept.matchId, sequence: 0 });
    // Fenced first, so the park has to leave the sweep able to reach the match
    // behind it rather than ending the run.
    await seedOutbox(page, [...fenced, kept, keptPoint]);

    await page.context().setOffline(false);
    await expect.poll(() => matchStatus(page, kept.matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => pointsOf(page, kept.matchId), { timeout: 20_000 }).toHaveLength(1);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(2);
    // The whole batch parks with the refusal on it, and nothing of it landed.
    const parked = await readOutboxRows(page);
    for (const row of parked) {
      expect(row).toMatchObject({
        matchId: completedId,
        status: "failed",
        failure: { status: 409, message: "Match is completed" },
      });
    }
    expect(await pointsOf(page, completedId)).toHaveLength(0);

    // A point appended behind the park must wait with it, never flush on its own:
    // a batch sent now would only park too, and the sync UI's retry (#115) is
    // what should decide the match's fate. The second match's point is the proof
    // the sweep ran past the held one.
    await page.context().setOffline(true);
    const late = buildPointRow({ coachId, matchId: completedId, sequence: 2 });
    const secondKept = buildPointRow({ coachId, matchId: kept.matchId, sequence: 1 });
    await seedOutbox(page, [late, secondKept]);
    await page.context().setOffline(false);
    await expect.poll(() => pointsOf(page, kept.matchId), { timeout: 20_000 }).toHaveLength(2);
    const held = (await readOutboxRows(page)).find((row) => row.id === late.id);
    expect(held).toMatchObject({ status: "pending" });
    expect(held).not.toHaveProperty("failure");
    expect(await pointsOf(page, completedId)).toHaveLength(0);
  });

  test("two matches captured in alternation each land whole and in order", async ({ page }) => {
    await openHome(page);
    const coachId = await recordedOwner(page);
    const playerId = await createPlayer(page);

    // A coach switching between two courts: each match is queued before its own
    // points, and the points of the two interleave in the queue.
    await page.context().setOffline(true);
    const marker = `E2E interleaved ${crypto.randomUUID()}`;
    const first = buildMatchRow({ coachId, playerId, opponentName: marker });
    const second = buildMatchRow({ coachId, playerId, opponentName: marker });
    const firstPoints = [0, 1, 2].map((sequence) =>
      buildPointRow({ coachId, matchId: first.matchId, sequence }),
    );
    const secondPoints = [0, 1, 2].map((sequence) =>
      buildPointRow({ coachId, matchId: second.matchId, sequence }),
    );
    await seedOutbox(page, [
      first,
      firstPoints[0]!,
      second,
      secondPoints[0]!,
      firstPoints[1]!,
      secondPoints[1]!,
      firstPoints[2]!,
      secondPoints[2]!,
    ]);

    await page.context().setOffline(false);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    // Per-match order holds whatever the queue interleaved, and neither match's
    // points strayed into the other.
    for (const [match, points] of [
      [first, firstPoints],
      [second, secondPoints],
    ] as const) {
      const stored = await pointsOf(page, match.matchId);
      expect(stored.map((point) => point.id)).toEqual(points.map((point) => point.id));
      expect(stored.map((point) => point.sequence)).toEqual([0, 1, 2]);
    }
    expect(await matchesNamed(page, marker)).toBe(2);
  });
});

test.describe("a session revoked mid-queue", () => {
  // Its own coach, signed up through the live API: this spec kills the session it
  // runs as, which must never be the one every other signed-in spec shares. No
  // service worker, so the drain's POST is a page request the spec can wait on.
  test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

  test("keeps the outbox, and signing back in flushes it", async ({ page, playwright }) => {
    const { email, password } = await signUpCoach(page, {
      prefix: "offline-401",
      displayName: "Revoked Coach",
    });
    expect((await postJson(page, "/api/auth/login", { email, password })).ok()).toBe(true);

    await openHome(page);
    const playerId = await createPlayer(page);
    await openCapture(page, playerId);

    // Offline across the taps, so the revocation below lands before the first send.
    await page.context().setOffline(true);
    const marker = `E2E revoked ${crypto.randomUUID()}`;
    await tapOutMatch(page, marker, ["ace"]);
    const { matchId } = await queuedByTaps(page);

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
    expect(rows.map((row) => [row.kind, row.status])).toEqual([
      ["match", "pending"],
      ["point", "pending"],
    ]);

    // Through the form, not the API: sign-in is the only caller of
    // purgeIfCoachChanged, and its same-coach branch is what has to leave the
    // queue standing. The reload after it is the drain's launch trigger.
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(
      page.getByRole("heading", { name: "Coach Revoked Coach", level: 1 }),
    ).toBeVisible();
    await page.reload();
    await expect.poll(() => matchStatus(page, matchId), { timeout: 20_000 }).toBe(200);
    await expect.poll(() => readOutboxRows(page), { timeout: 20_000 }).toHaveLength(0);
    expect(await matchesNamed(page, marker)).toBe(1);
  });
});
