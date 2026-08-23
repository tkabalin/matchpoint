import type { MatchRead } from "@matchpoint/api-client";
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

import { MatchStatsPage } from "./match-stats-page";

const match: MatchRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  player_id: "3f1c2b4e-0000-4000-8000-000000000001",
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: "win",
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

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

// Nested under a pathless `_authenticated` layout, matching the real route tree —
// MatchStatsPage resolves its params via `getRouteApi("/_authenticated/matches/$matchId")`,
// which needs an active match at that exact route id.
function buildRouter(matchId: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <Outlet />,
  });
  const matchesRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/matches",
    component: () => <h1>Matches</h1>,
  });
  const matchStatsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/matches/$matchId",
    component: MatchStatsPage,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([matchesRoute, matchStatsRoute]),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/matches/${matchId}`] }),
  });
}

async function renderPage(matchId = match.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = buildRouter(matchId);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the match's own summary and its result", async () => {
  stubFetch({ [`/api/matches/${match.id}`]: () => Response.json(match) });

  await renderPage();

  expect(screen.getByText("Aug 10 · Hard")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Won" })).toBeInTheDocument();
});

test("links back to the matches list", async () => {
  stubFetch({ [`/api/matches/${match.id}`]: () => Response.json(match) });
  const user = userEvent.setup();
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to matches" }));

  expect(await screen.findByRole("heading", { name: "Matches" })).toBeInTheDocument();
});

test("opens on the Serve tab, with the same Serve/Rally toggle the player page uses", async () => {
  stubFetch({ [`/api/matches/${match.id}`]: () => Response.json(match) });
  await renderPage();

  expect(await screen.findByText("Your serve")).toBeInTheDocument();
  expect(screen.queryByText("Point enders")).not.toBeInTheDocument();
});

test("switches to Rally when its toggle is clicked", async () => {
  stubFetch({ [`/api/matches/${match.id}`]: () => Response.json(match) });
  const user = userEvent.setup();
  await renderPage();
  await screen.findByText("Your serve");

  await user.click(screen.getByRole("button", { name: "Rally" }));

  expect(await screen.findByText("Point enders")).toBeInTheDocument();
});

test("shows a load error instead of an indefinite skeleton", async () => {
  stubFetch({
    [`/api/matches/${match.id}`]: () =>
      new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = buildRouter(match.id);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Could not load that match.")).toBeInTheDocument();
});
