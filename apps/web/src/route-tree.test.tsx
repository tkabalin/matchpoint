import type { CoachRead, PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { getCurrentCoachOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { QueryClient, dehydrate, onlineManager } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { purgeIfOwnerChanged, recordOwnerIfUnknown } from "@/lib/local-data";
import { queryPersistOptions, removePersistedQueryCache } from "@/lib/query-persist";

import { routeTree } from "./routeTree.gen";

// Every other route test builds its own hand-written tree, so none of them see how the
// router plugin actually parents the route files: `/players/$playerId` was generated as
// a child of the roster and so never rendered, and the `_authenticated` guard (#98)
// never runs at all. These mount the generated tree instead.

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "coach@example.com",
  display_name: "Danny",
  default_surface: null,
  default_scoring_system: null,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const playerSelf: PlayerSelfRead = {
  id: player.id,
  first_name: player.first_name,
  last_name: player.last_name,
  username: player.username,
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  photo_url: null,
  created_at: player.created_at,
  updated_at: player.updated_at,
};

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[pathname];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

async function renderRouteTreeAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  // Mount the way main.tsx does, then await the router's own load rather than leaving
  // the guard, any redirect and the lazy chunk inside the `findBy*` poll below, whose
  // budget is the narrowest in the suite: docs/testing.md.
  await router.load();
}

/**
 * Seeds the persisted snapshot with what a previous online visit would have cached,
 * then waits for the write to land: the persister throttles, so its promise can
 * resolve before the store has it.
 *
 * The wait carries the suite's poll budget rather than `vi.waitFor`'s own, which is
 * one second, the same length as the throttle window it is waiting out.
 */
async function persistLastVisit() {
  const seed = new QueryClient();
  seed.setQueryData(getCurrentCoachOptions().queryKey, coach);
  seed.setQueryData(listPlayersOptions().queryKey, [player]);

  await queryPersistOptions.persister.persistClient({
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: dehydrate(seed),
  });
  await vi.waitFor(
    async () => {
      expect(await queryPersistOptions.persister.restoreClient()).toBeDefined();
    },
    { timeout: 5_000 },
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
  localStorage.clear();
  await removePersistedQueryCache();
});

test("/players renders the roster", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([player]),
  });

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("/players/$playerId renders that player's profile, not the roster", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  await renderRouteTreeAt(`/players/${player.id}`);

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Players" })).not.toBeInTheDocument();
});

test("redirects to sign-in on a confirmed 401, instead of rendering the protected route", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("renders the protected route through a non-401 session-check failure", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Server error" }, { status: 500 }),
    "/api/players": () => Response.json([player]),
  });

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

// The 500 above already covers the non-401 branch; 429 is pinned separately because the
// API's per-coach budget is shared across every endpoint, so a burst of captures can
// make the session check itself the request that gets refused.
test("renders the protected route when the session check is rate-limited", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Too many requests" }, { status: 429 }),
    "/api/players": () => Response.json([player]),
  });

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("renders a protected route from the persisted cache with no connection", async () => {
  await persistLastVisit();
  // Query pauses rather than fails while the browser reports itself offline, so the
  // guard's session check only settles because it asks for offlineFirst. Without
  // that, beforeLoad never resolves and nothing behind the guard renders at all.
  onlineManager.setOnline(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
});

test("a confirmed 401 leaves no persisted snapshot on the device", async () => {
  await persistLastVisit();
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  await renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();
});

test("a confirmed session claims a device nothing has claimed yet", async () => {
  await outboxDb.delete();
  await outboxDb.open();
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([player]),
  });

  renderRouteTreeAt("/players");
  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
  await append({
    id: "3f1c2b4e-0000-4000-8000-0000000000a1",
    coachId: coach.id,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
  await purgeIfOwnerChanged(coach.id, new QueryClient(), "coach");

  // A session older than the ownership record leaves nothing claiming the device, and
  // its own coach then reads as a stranger the next time they sign in (#117).
  expect(await readPending(coach.id)).toHaveLength(1);
});

test("a confirmed 401 keeps the points that never synced", async () => {
  await outboxDb.delete();
  await outboxDb.open();
  await append({
    id: "3f1c2b4e-0000-4000-8000-0000000000a1",
    coachId: coach.id,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  renderRouteTreeAt("/players");

  // A session the server ended is not the same as the coach leaving the device: they
  // sign back in and the points they captured courtside are still there (#117).
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  expect(await readPending(coach.id)).toHaveLength(1);
});

// #203: a player session under `_player`, mirroring the `_authenticated` guard
// tests above — a player typing a coach-only URL never reaches it in the first
// place, but `/me` itself needs the same confirmed-401/non-401/ownership behavior.
test("/me renders the player's own view", async () => {
  stubFetch({
    "/api/auth/player/me": () => Response.json(playerSelf),
    [`/api/players/${player.id}/analytics/opponents`]: () => Response.json([]),
    [`/api/players/${player.id}/analytics/overview`]: () =>
      Response.json({ record: { wins: 0, losses: 0 }, form: null, days_since_last_match: null }),
    "/api/matches": () => Response.json([]),
    [`/api/players/${player.id}/analytics/serve`]: () =>
      Response.json({
        serving: {
          breakdown: [],
          hero: null,
          metrics: [],
          outcome: { first_serve: null, second_serve: null },
          fault_mode: { first_serve: null, second_serve: null },
          return_outcome: { first_serve: [], second_serve: [] },
          trend: [],
        },
        returning: {
          breakdown: [],
          hero: null,
          metrics: [],
          outcome: { first_serve: null, second_serve: null },
          fault_mode: { first_serve: null, second_serve: null },
          return_outcome: { first_serve: [], second_serve: [] },
          trend: [],
        },
      }),
  });

  await renderRouteTreeAt("/me");

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
});

test("redirects a player session to sign-in on a confirmed 401", async () => {
  stubFetch({
    "/api/auth/player/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  await renderRouteTreeAt("/me");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

// #257: `/` used to render the sign-in form unconditionally, with no session check at
// all — these are its inverse of the `_authenticated`/`_player` guard tests above.
test("/ redirects straight to /home with a live coach session, rather than showing the form", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([player]),
    "/api/squad/analytics/members": () => Response.json([]),
  });

  await renderRouteTreeAt("/");

  expect(await screen.findByRole("heading", { name: "Coach Danny" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Sign In" })).not.toBeInTheDocument();
});

test("/ redirects straight to /me with a live player session, rather than showing the form", async () => {
  stubFetch({
    // A player session 401s against the coach-only check first — the same
    // "not this kind of principal" answer a real player session gets.
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
    "/api/auth/player/me": () => Response.json(playerSelf),
    [`/api/players/${player.id}/analytics/opponents`]: () => Response.json([]),
    [`/api/players/${player.id}/analytics/overview`]: () =>
      Response.json({ record: { wins: 0, losses: 0 }, form: null, days_since_last_match: null }),
    "/api/matches": () => Response.json([]),
    [`/api/players/${player.id}/analytics/serve`]: () =>
      Response.json({
        serving: {
          breakdown: [],
          hero: null,
          metrics: [],
          outcome: { first_serve: null, second_serve: null },
          fault_mode: { first_serve: null, second_serve: null },
          return_outcome: { first_serve: [], second_serve: [] },
          trend: [],
        },
        returning: {
          breakdown: [],
          hero: null,
          metrics: [],
          outcome: { first_serve: null, second_serve: null },
          fault_mode: { first_serve: null, second_serve: null },
          return_outcome: { first_serve: [], second_serve: [] },
          trend: [],
        },
      }),
  });

  await renderRouteTreeAt("/");

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Sign In" })).not.toBeInTheDocument();
});

test("/ shows the sign-in form with no session at all", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
    "/api/auth/player/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  await renderRouteTreeAt("/");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

// Regression: a *confirmed* 401 (from both checks) used to fall into the same
// offline fallback as a genuine network failure, so a coach or player whose
// session was revoked elsewhere — which never clears the recorded owner — got
// redirected straight back into the app. That guard's own confirmed 401 then
// cleared the cache and redirected back to /, landing in this same catch with
// the marker still set: an infinite loop, never once showing the form.
test("/ shows the form on a confirmed 401 from both checks, even with an owner recorded from before", async () => {
  recordOwnerIfUnknown(coach.id, "coach");
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
    "/api/auth/player/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  await renderRouteTreeAt("/");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("/ goes to /home for a recorded coach with no connection, not the form", async () => {
  // The query cache's own persisted snapshot isn't available yet at this beforeLoad —
  // PersistQueryClientProvider restores it into context.queryClient on mount, in
  // RootLayout, which runs after this guard rather than before it (root-layout.tsx's
  // own comment). getRecordedOwnerKind() is what stands in for it here: set the
  // moment any session check first succeeds on this device, offline-readable, and
  // cleared only by an explicit sign-out.
  recordOwnerIfUnknown(coach.id, "coach");
  onlineManager.setOnline(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await renderRouteTreeAt("/");

  // Redirected to /home on the strength of getRecordedOwnerKind() alone — every
  // query Home itself issues is failing offline too, so this only proves the
  // redirect happened, not that Home's own data loaded.
  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test("/ goes to /me for a recorded player with no connection, not the form", async () => {
  recordOwnerIfUnknown(player.id, "player");
  onlineManager.setOnline(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await renderRouteTreeAt("/");

  // Redirected to /me on the strength of getRecordedOwnerKind() alone — the
  // player's own getCurrentPlayerOptions() query fails offline too, so
  // PlayerSelfView sits on its own loading skeleton. That's the proof the
  // redirect landed on /me rather than /home, without needing its data to load.
  await vi.waitFor(() => {
    expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  });
  expect(screen.queryByRole("heading", { name: "Sign In" })).not.toBeInTheDocument();
});

test("/ shows the form, not the app, with no connection and no owner recorded", async () => {
  onlineManager.setOnline(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  await renderRouteTreeAt("/");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

// #194: this app's first public, non-auth routes besides the auth screens
// themselves — no request of any kind, so unlike every test above, neither
// needs `stubFetch` nor sits under the `_authenticated` guard.
test("/privacy renders with no signed-in session", async () => {
  await renderRouteTreeAt("/privacy");

  expect(await screen.findByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
});

test("/terms renders with no signed-in session", async () => {
  await renderRouteTreeAt("/terms");

  expect(await screen.findByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
});

// #193: the router plugin originally parented this as a child of
// `/settings/support`, which renders no `<Outlet/>` — so the URL changed but
// nothing new appeared. Every other test of this page built its own flat,
// hand-written tree, which can't reproduce that: only the generated tree
// (mounted here, the same way `/players/$playerId` above catches its own
// parenting trap) can catch a route nested under the wrong parent.
test("/settings/faq renders as its own page, not nested under Support", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
  });

  await renderRouteTreeAt("/settings/faq");

  expect(await screen.findByRole("heading", { name: "Help & feedback" })).toBeInTheDocument();
});
