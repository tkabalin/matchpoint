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

import { PlayerProfile } from "./player-profile";

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: "Strong two-handed backhand.",
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  archived_at: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/** Routes by pathname — this page fetches both the player and their matches. */
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

async function renderPlayerProfile(playerId = player.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Welcome to Home</h1>,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: PlayerProfile,
  });
  const routeTree = rootRoute.addChildren([homeRoute, profileRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/players/${playerId}`] }),
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

test("renders the player's name and static fields", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.getByText("AN")).toBeInTheDocument();
  expect(screen.getByText("2008-04-12")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  expect(screen.getByText("Strong two-handed backhand.")).toBeInTheDocument();
});

test("shows a placeholder for unset fields", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () =>
      Response.json({ ...player, date_of_birth: null, dominant_hand: null, notes: null }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  await screen.findByRole("heading", { name: "Amahle Nkosi" });
  expect(screen.getAllByText("—")).toHaveLength(3);
});

test("shows that player's match count", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () =>
      Response.json([
        {
          id: "3f1c2b4e-0000-4000-8000-00000000ma01",
          player_id: player.id,
          opponent_name: "T. Naidoo",
          played_on: "2026-08-10",
          surface: "hard",
          event: null,
          sets_format: "best_of_3",
          created_at: "2026-08-11T09:00:00Z",
          updated_at: "2026-08-11T09:00:00Z",
        },
      ]),
  });

  await renderPlayerProfile();

  expect(await screen.findByText("Matches: 1")).toBeInTheDocument();
});

test("shows an error message when the player can't be loaded", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => new Response(null, { status: 404 }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load that player.");
});

test("links back to home", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("link", { name: "← Home" }));

  expect(await screen.findByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});
