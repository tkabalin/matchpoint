import type { CoachRead, PlayerRead } from "@matchpoint/api-client";
import { getCurrentCoachOptions, listPlayersOptions } from "@matchpoint/api-client/react-query";
import { QueryClient, dehydrate, onlineManager } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { purgeIfCoachChanged } from "@/lib/local-data";
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
  await purgeIfCoachChanged(coach.id, new QueryClient());

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
