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

import { getLastViewedPlayerId } from "@/lib/last-viewed-player";

import { PlayerList } from "./player-list";

// Annotated rather than inferred so tsc holds the fixture to the generated contract:
// an un-annotated literal happily describes a response the API cannot return.
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

/** Stubs the transport rather than the generated client: the client is what's under test.
 *
 * Takes a factory, not a Response: a body can be read only once, so a single instance
 * handed to every call would resolve a second request in the same test — a refetch, or
 * a retry — with an unusable body rather than the fixture set up here.
 */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders PlayerList inside a real (in-memory) router — its entries now link to the
 * player profile route. */
async function renderPlayerList() {
  // retry off so the error path resolves in one attempt instead of on Query's backoff.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: PlayerList,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const routeTree = rootRoute.addChildren([playersRoute, profileRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("renders the players the API returns", async () => {
  stubFetch(() => Response.json([player]));

  await renderPlayerList();

  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
});

test("requests the roster from the API's own origin", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayerList();

  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(String(request instanceof Request ? request.url : request)).toContain("/api/players");
});

test("reports a failed load instead of rendering an empty roster", async () => {
  stubFetch(() => new Response("nope", { status: 500 }));

  await renderPlayerList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load players.");
});

test("prompts to sign in again on a 401, instead of the generic error", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "Not signed in" }), { status: 401 }));

  await renderPlayerList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired.");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/");
});

test("clicking a player opens their profile and records them as last-viewed", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup();
  await renderPlayerList();

  await user.click(await screen.findByRole("link", { name: "Amahle Nkosi" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
  expect(getLastViewedPlayerId()).toBe(player.id);
});
