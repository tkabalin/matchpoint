import type { MatchRead, PlayerSelfRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerMatchList } from "./player-match-list";

const player: PlayerSelfRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Nomsa",
  last_name: "Dube",
  username: "nomsa-dube",
  photo_url: null,
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
};

const match: MatchRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  player_id: player.id,
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

function stubFetch(routes: { matches?: () => Response; playerSelf?: () => Response }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/matches")
        return Promise.resolve((routes.matches ?? (() => Response.json([])))());
      if (pathname === "/api/auth/player/me")
        return Promise.resolve((routes.playerSelf ?? (() => Response.json(player)))());
      if (/^\/api\/matches\/[^/]+\/points$/.test(pathname))
        return Promise.resolve(Response.json([]));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderPlayerMatchList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/matches",
    component: PlayerMatchList,
  });
  const routeTree = rootRoute.addChildren([matchesRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me/matches"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the player's own matches, with no Edit or Delete controls", async () => {
  stubFetch({ matches: () => Response.json([match]) });

  renderPlayerMatchList();

  expect(await screen.findByText("Nomsa Dube")).toBeInTheDocument();
  expect(screen.getByText("T. Naidoo")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit details/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete the match/ })).not.toBeInTheDocument();
});

test("shows an empty state with no matches yet", async () => {
  stubFetch({ matches: () => Response.json([]) });

  renderPlayerMatchList();

  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

test("reports a failed load instead of rendering an empty list", async () => {
  stubFetch({ matches: () => new Response("nope", { status: 500 }) });

  renderPlayerMatchList();

  expect(await screen.findByText("Could not load matches.")).toBeInTheDocument();
});
