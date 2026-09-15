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

import { StartMatch } from "./start-match";

function playerNamed(id: string, first: string, last: string): PlayerRead {
  return {
    id,
    first_name: first,
    last_name: last,
    username: `${last.toLowerCase()}${first.toLowerCase()}`,
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
}

const amahle = playerNamed("3f1c2b4e-0000-4000-8000-000000000001", "Amahle", "Nkosi");
const thabo = playerNamed("3f1c2b4e-0000-4000-8000-000000000002", "Thabo", "Dlamini");

function stubPlayers(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

function renderStartMatch({ initialEntries = ["/new-match"] }: { initialEntries?: string[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <Outlet />,
  });
  const startMatchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/new-match",
    component: StartMatch,
  });
  const setupRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/new-match/$playerId",
    component: () => <h1>Match Setup</h1>,
  });
  const matchesRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/matches",
    component: () => <h1>Matches</h1>,
  });
  const homeRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([startMatchRoute, setupRoute, matchesRoute, homeRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
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

test("lists the coach's roster to pick from", async () => {
  stubPlayers(() => Response.json([amahle, thabo]));
  renderStartMatch();

  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
  expect(screen.getByText("Thabo Dlamini")).toBeInTheDocument();
});

test("search narrows the roster to matching names", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle, thabo]));
  renderStartMatch();
  await screen.findByText("Amahle Nkosi");

  await user.type(screen.getByLabelText("Search for a player"), "dlam");

  expect(screen.getByText("Thabo Dlamini")).toBeInTheDocument();
  expect(screen.queryByText("Amahle Nkosi")).not.toBeInTheDocument();
});

// The empty state is the same one an empty roster gets, deliberately: from here the
// answer to both is to add the player before starting their match.
test("a search matching nobody explains how to proceed", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle]));
  renderStartMatch();
  await screen.findByText("Amahle Nkosi");

  await user.type(screen.getByLabelText("Search for a player"), "zzz");

  expect(screen.getByText("No players found")).toBeInTheDocument();
  expect(screen.getByText("Add the player first, then start their match.")).toBeInTheDocument();
});

test("an empty roster shows the same guidance rather than a bare list", async () => {
  stubPlayers(() => Response.json([]));
  renderStartMatch();

  expect(await screen.findByText("No players found")).toBeInTheDocument();
});

test("picking a player carries their id into match setup", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle, thabo]));
  renderStartMatch();

  await user.click(await screen.findByText("Thabo Dlamini"));

  expect(await screen.findByRole("heading", { name: "Match Setup" })).toBeInTheDocument();
});

// Reachable from Matches' own FAB and from Home's now (PrimaryMatchAction) — a fixed
// "/matches" destination sent every Home-originated visit somewhere it didn't come
// from, so the back control has to pop real history instead of hardcoding one.
test("the back control returns to Matches when that's where the coach came from", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle]));
  renderStartMatch({ initialEntries: ["/matches", "/new-match"] });
  await screen.findByText("Amahle Nkosi");

  await user.click(screen.getByLabelText("Back"));

  expect(await screen.findByRole("heading", { name: "Matches" })).toBeInTheDocument();
});

test("the back control returns to Home when that's where the coach came from", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle]));
  renderStartMatch({ initialEntries: ["/home", "/new-match"] });
  await screen.findByText("Amahle Nkosi");

  await user.click(screen.getByLabelText("Back"));

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test("the back control falls back to Home for a direct link with no history to pop", async () => {
  const user = userEvent.setup({ delay: null });
  stubPlayers(() => Response.json([amahle]));
  renderStartMatch({ initialEntries: ["/new-match"] });
  await screen.findByText("Amahle Nkosi");

  await user.click(screen.getByLabelText("Back"));

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

// The roster is a request, so there is a window with nothing to list. Placeholders
// rather than the empty state: "no players found" is a claim the app cannot make yet,
// and the coach would read it as an answer rather than as waiting.
test("shows placeholders while the roster is still loading, not the empty state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => new Promise(() => {})),
  );
  renderStartMatch();

  expect(await screen.findByRole("heading", { name: "Start a match" })).toBeInTheDocument();
  expect(screen.queryByText("No players found")).not.toBeInTheDocument();
});
