import type { PlayerRead } from "@matchpoint/api-client";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { routeTree } from "./routeTree.gen";

// Every other route test builds its own hand-written tree, so none of them see how the
// router plugin actually parents the route files: `/players/$playerId` was generated as
// a child of the roster and so never rendered. These mount the generated tree instead.

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  archived_at: null,
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
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("/players renders the roster", async () => {
  stubFetch({ "/api/players": () => Response.json([player]) });

  renderRouteTreeAt("/players");

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("/players/$playerId renders that player's profile, not the roster", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  renderRouteTreeAt(`/players/${player.id}`);

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Players" })).not.toBeInTheDocument();
});
