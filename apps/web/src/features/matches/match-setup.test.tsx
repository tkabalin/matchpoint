import type { PlayerRead } from "@matchpoint/api-client";
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
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { MatchSetup } from "./match-setup";

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

function stubFetch(response: () => Response = () => Response.json(player)) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

async function renderMatchSetup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <Outlet />,
  });
  const profileRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/new-match/$playerId",
    component: MatchSetup,
  });
  const rosterRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/players",
    component: () => <h1>Players</h1>,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([profileRoute, newMatchRoute, rosterRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/new-match/${player.id}`] }),
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

test("renders the setup form for the player", async () => {
  stubFetch();
  await renderMatchSetup();

  expect(await screen.findByRole("heading", { name: "New match — Amahle" })).toBeInTheDocument();
  expect(screen.getByLabelText("Opponent")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hard" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Best of 3" })).toBeInTheDocument();
});

test("the start match button is disabled — nowhere for it to go yet", async () => {
  stubFetch();
  await renderMatchSetup();

  await screen.findByRole("heading", { name: "New match — Amahle" });
  expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();
});

test("cancel returns to the player profile", async () => {
  stubFetch();
  const user = userEvent.setup();
  await renderMatchSetup();
  await screen.findByRole("heading", { name: "New match — Amahle" });

  await user.click(screen.getByRole("link", { name: "Cancel" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

// Reachable by typing a url, or from a stale link after the player was archived.
// Before #78 this rendered the form headed "New match" with no name, offering to
// start a match for a player the coach cannot see.
test("says not found instead of an unnamed form when the player isn't the coach's", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 }));

  await renderMatchSetup();

  expect(await screen.findByText("Player not found")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /New match/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
});
