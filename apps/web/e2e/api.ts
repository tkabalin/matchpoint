import { expect, test, type Page } from "@playwright/test";

import { readVerificationCode } from "./mail";

/**
 * Talking to the live API from a spec, and the small amount of app state a spec
 * has to read back off the device.
 *
 * Extracted from offline.spec.ts once capture-claim.spec.ts had copied the first
 * three of these verbatim and a third spec file was about to copy them again.
 * Every write here carries the Origin header for the reason postJson gives.
 */

/** OWNER_KEY in src/lib/local-data.ts: whose rows a drain flushes. */
export const OWNER_KEY = "matchpoint:local-data-owner";

/**
 * The origin the run is against, read from the project rather than spelled out:
 * a port changed in the config would otherwise turn every write below into a 403
 * whose message says nothing about where the mismatch came from.
 *
 * Called per test, never hoisted to module scope: offline-chromium runs against
 * the production build on another port than every other project.
 */
export function originUnderTest(): string {
  return test.info().project.use.baseURL!;
}

/**
 * POSTs as the app itself would. The API refuses a write whose Origin is not
 * its own (csrf.py), and Playwright's request context, unlike a browser page,
 * sends no Origin at all unless told to.
 */
export function postJson(page: Page, url: string, data: unknown) {
  return page.request.post(url, { data, headers: { origin: originUnderTest() } });
}

/** The coach id the visit to an authenticated route just recorded. */
export async function recordedOwner(page: Page): Promise<string> {
  const owner = await page.evaluate((key) => localStorage.getItem(key), OWNER_KEY);
  expect(owner, "no owner recorded; did the authenticated route load?").not.toBeNull();
  return owner as string;
}

/**
 * A player of this coach's for matches to track, via the live API. Both names are
 * parameters because the coach is shared across every project in the run, so a
 * spec that reads its own player back off a screen needs a name no other spec
 * will have produced. The default surname is random rather than a timestamp: two
 * workers can start inside the same millisecond.
 */
export async function createPlayer(
  page: Page,
  names: { firstName?: string; lastName?: string } = {},
): Promise<string> {
  const response = await postJson(page, "/api/players", {
    first_name: names.firstName ?? "E2E",
    last_name: names.lastName ?? `Player ${crypto.randomUUID().slice(0, 8)}`,
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Removes a player, as a second device could while this one is offline. */
export async function deletePlayer(page: Page, playerId: string): Promise<void> {
  const response = await page.request.delete(`/api/players/${playerId}`, {
    headers: { origin: originUnderTest() },
  });
  expect(response.status()).toBe(204);
}

/** How many of the coach's matches carry this marker name: the exactly-once probe. */
export async function matchesNamed(page: Page, opponentName: string): Promise<number> {
  const response = await page.request.get("/api/matches");
  expect(response.status()).toBe(200);
  const matches = (await response.json()) as { opponent_name: string | null }[];
  return matches.filter((match) => match.opponent_name === opponentName).length;
}

export async function matchStatus(page: Page, matchId: string): Promise<number> {
  return (await page.request.get(`/api/matches/${matchId}`)).status();
}

/** The id of the one match carrying this marker, once the server has it. */
export async function matchIdNamed(page: Page, opponentName: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/matches");
        expect(response.status()).toBe(200);
        const matches = (await response.json()) as { id: string; opponent_name: string | null }[];
        id = matches.find((match) => match.opponent_name === opponentName)?.id;
        return id;
      },
      { timeout: 20_000 },
    )
    .toBeDefined();
  return id!;
}

/**
 * The match's `result` as the server holds it, or null while it is still in
 * progress. The probe for whether an outcome PATCH ever landed.
 */
export async function matchResult(page: Page, matchId: string): Promise<string | null> {
  const response = await page.request.get(`/api/matches/${matchId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { result: string | null }).result;
}

export interface StoredPoint {
  id: string;
  sequence: number;
  serve1_outcome: string | null;
  end_reason: string | null;
}

/** A match's points as the server holds them, in the order it assigns: by sequence. */
export async function pointsOf(page: Page, matchId: string): Promise<StoredPoint[]> {
  const response = await page.request.get(`/api/matches/${matchId}/points`);
  expect(response.status()).toBe(200);
  return (await response.json()) as StoredPoint[];
}

/**
 * A match already on the server and already decided, which is the one state the
 * ingest route refuses for good: sent from a request context, as a second device
 * or the dashboard would have done it, never through this device's queue.
 */
export async function completeMatchOnServer(page: Page, playerId: string): Promise<string> {
  const matchId = crypto.randomUUID();
  const created = await postJson(page, "/api/matches", {
    id: matchId,
    player_id: playerId,
    played_on: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    scoring_system: "traditional",
  });
  expect(created.status()).toBe(201);
  const completed = await page.request.patch(`/api/matches/${matchId}`, {
    data: { result: "win" },
    headers: { origin: originUnderTest() },
  });
  expect(completed.status()).toBe(200);
  return matchId;
}

/** Signed-in load that the drain and the seeds both need to have happened. */
export async function openHome(page: Page): Promise<void> {
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * A coach of this spec's own, signed up as requests rather than form fills: the
 * form is auth.setup.ts's subject, and a caller here only needs the account.
 *
 * Any spec that ends the session it runs as needs one. The shared storage state
 * is a single token replayed into every context in the run, and `logout` deletes
 * the coach_sessions row it hashes to, so signing out with it would 401 every
 * other signed-in spec still to come.
 */
export async function signUpCoach(
  page: Page,
  { prefix, displayName }: { prefix: string; displayName: string },
): Promise<Credentials> {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 12)}@example.com`;
  // Long enough for the strength meter and unrelated to the address, which the
  // API penalises a password for echoing (password_policy.py).
  const password = "drop-volley-lantern-83";

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
  return { email, password };
}
