import type { CoachRead, PlayerRead } from "@matchpoint/api-client";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

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
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "coach@example.com",
  display_name: "Danny",
  default_surface: null,
  default_scoring_system: null,
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

function renderRouteTreeAt(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("/players renders the roster", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([player]),
  });

  renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("/players/$playerId renders that player's profile, not the roster", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  renderRouteTreeAt(`/players/${player.id}`);

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Players" })).not.toBeInTheDocument();
});

test("redirects to sign-in on a confirmed 401, instead of rendering the protected route", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Not signed in" }, { status: 401 }),
  });

  renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("renders the protected route through a non-401 session-check failure", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ detail: "Server error" }, { status: 500 }),
    "/api/players": () => Response.json([player]),
  });

  renderRouteTreeAt("/players");

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

  renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});
