import type { MatchCaptureClaim, MatchRead } from "@matchpoint/api-client";
import { zMatchCaptureClaim } from "@matchpoint/api-client/zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { saveMatch } from "@/features/outbox/match-log";
import { append } from "@/features/outbox/outbox";
import { getDeviceId } from "@/lib/device-id";

import { attemptClaim, useCaptureClaim } from "./capture-claim";

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000002";

const finishedMatch: MatchRead = {
  id: MATCH_ID,
  player_id: PLAYER_ID,
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: "win",
  result_reason: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};
const openMatch: MatchRead = { ...finishedMatch, result: null };

/** Routes by pathname and method, the same shape `matches-page.test.tsx` uses. */
function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[pathname];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler(input));
    }),
  );
}

// Same helper `flush-triggers.test.ts` uses — jsdom's `navigator.onLine` is an
// accessor on the prototype, not an own property, so it has to be redefined
// rather than spied on directly.
function setOnLine(onLine: boolean): void {
  Object.defineProperty(navigator, "onLine", { value: onLine, configurable: true });
}

beforeEach(async () => {
  await outboxDb.entries.clear();
  await outboxDb.matches.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("attemptClaim", () => {
  test("does not call the server while offline", async () => {
    setOnLine(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not call the server while the match's own create is still queued", async () => {
    await append({
      id: MATCH_ID,
      coachId: COACH_ID,
      matchId: MATCH_ID,
      kind: "match",
      payload: {},
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // A claim sent ahead of the create landing would race it and could read
    // back a spurious 404 — see attemptClaim's own comment.
    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("claims outright on a clean 200", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ device_id: getDeviceId(), expires_at: "2026-08-11T13:00:00Z" }),
    });

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "claimed" });
  });

  test("sends the device id the request body contract expects", async () => {
    let sentBody: MatchCaptureClaim | undefined;
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: async (input) => {
        sentBody = (await input.json()) as MatchCaptureClaim;
        return Response.json({ device_id: getDeviceId(), expires_at: "2026-08-11T13:00:00Z" });
      },
    });

    await attemptClaim(MATCH_ID, getDeviceId());

    expect(zMatchCaptureClaim.safeParse(sentBody).success).toBe(true);
  });

  test("reports a conflict on a 409 whose match has no result yet", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
      [`/api/matches/${MATCH_ID}`]: () => Response.json(openMatch),
    });

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "conflict" });
  });

  test("reports the match finished on a 409 whose result is already recorded", async () => {
    // Both 409 causes share one response shape — only the match's own `result`,
    // never the message, tells them apart.
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
      [`/api/matches/${MATCH_ID}`]: () => Response.json(finishedMatch),
    });

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "finished" });
  });

  test("reports gone on a 404 from the claim itself", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ detail: "Match not found" }, { status: 404 }),
    });

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "gone" });
  });

  test("reports gone on a 404 from the follow-up read after a 409", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
      [`/api/matches/${MATCH_ID}`]: () =>
        Response.json({ detail: "Match not found" }, { status: 404 }),
    });

    expect(await attemptClaim(MATCH_ID, getDeviceId())).toEqual({ kind: "gone" });
  });
});

describe("useCaptureClaim", () => {
  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  function seedInProgressMatch() {
    return saveMatch({
      matchId: MATCH_ID,
      coachId: COACH_ID,
      trackedPlayerId: PLAYER_ID,
      nextSequence: 1,
      finished: false,
      updatedAt: Date.now(),
      payload: {},
    });
  }

  test("claims silently once the in-progress match is known", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ device_id: getDeviceId(), expires_at: "2026-08-11T13:00:00Z" }),
    });
    await seedInProgressMatch();

    const { result } = renderHook(
      () => useCaptureClaim({ coachId: COACH_ID, trackedPlayerId: PLAYER_ID }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.matchId).toBe(MATCH_ID));
    // Silent success: no conflict, no takeover, nothing to tell the coach.
    expect(result.current.conflict).toBe(false);
    expect(result.current.gone).toBe(false);
    expect(result.current.finishedElsewhere).toBe(false);
  });

  test("re-attempts the claim once the browser comes back online", async () => {
    setOnLine(false);
    let claimed = false;
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () => {
        claimed = true;
        return Response.json({ device_id: getDeviceId(), expires_at: "2026-08-11T13:00:00Z" });
      },
    });
    await seedInProgressMatch();

    renderHook(() => useCaptureClaim({ coachId: COACH_ID, trackedPlayerId: PLAYER_ID }), {
      wrapper,
    });

    // Offline the whole time so far — nothing should have reached the server.
    expect(claimed).toBe(false);

    setOnLine(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(claimed).toBe(true));
  });

  test("surfaces a conflict, then lets takeOver claim it", async () => {
    let released = false;
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        released
          ? Response.json({ device_id: getDeviceId(), expires_at: "2026-08-11T13:00:00Z" })
          : Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
      [`/api/matches/${MATCH_ID}`]: () => Response.json(openMatch),
      [`/api/matches/${MATCH_ID}/capture/release`]: () => {
        released = true;
        return new Response(null, { status: 204 });
      },
    });
    await seedInProgressMatch();

    const { result } = renderHook(
      () => useCaptureClaim({ coachId: COACH_ID, trackedPlayerId: PLAYER_ID }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.conflict).toBe(true));

    result.current.takeOver();

    await waitFor(() => expect(result.current.conflict).toBe(false));
  });

  test("surfaces a repeat conflict from takeOver as an error, not a silent close", async () => {
    stubFetch({
      [`/api/matches/${MATCH_ID}/capture`]: () =>
        Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
      [`/api/matches/${MATCH_ID}`]: () => Response.json(openMatch),
      [`/api/matches/${MATCH_ID}/capture/release`]: () => new Response(null, { status: 204 }),
    });
    await seedInProgressMatch();

    const { result } = renderHook(
      () => useCaptureClaim({ coachId: COACH_ID, trackedPlayerId: PLAYER_ID }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.conflict).toBe(true));

    result.current.takeOver();

    await waitFor(() =>
      expect(result.current.takeoverError).toBe("Still being captured on that device. Try again."),
    );
    // Still shown as a conflict — the prompt stays open rather than closing on a
    // takeover that didn't actually succeed.
    expect(result.current.conflict).toBe(true);
  });
});
