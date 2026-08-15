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

import { PlayersPage } from "./players-page";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders PlayersPage inside a real (in-memory) router — its bottom nav needs
 * router context regardless of what the roster itself renders. */
async function renderPlayersPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: PlayersPage,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches",
    component: () => <h1>Matches</h1>,
  });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: () => <h1>Stats</h1>,
  });
  const routeTree = rootRoute.addChildren([playersRoute, homeRoute, matchesRoute, statsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Players" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the page heading and the roster", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayersPage();

  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
});

test("renders the bottom nav with Players active", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayersPage();

  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Players" })).toHaveAttribute("aria-current", "page");
});
