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

import { Home } from "./home";

const coach = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "coach@example.com",
  display_name: "Danny",
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const players: PlayerRead[] = [
  {
    id: "3f1c2b4e-0000-4000-8000-000000000001",
    first_name: "Amahle",
    last_name: "Nkosi",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    archived_at: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
  {
    id: "3f1c2b4e-0000-4000-8000-000000000002",
    first_name: "Sipho",
    last_name: "Dlamini",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    archived_at: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
];

/** Routes by pathname rather than returning one canned response for every call:
 * Home now fetches both /coaches/me and /players, which need different shapes. */
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

function stubAuthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
  });
}

function stubUnauthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json([]),
  });
}

/** Renders Home inside a real (in-memory) router — its Profile/Settings links need
 * router context, same reasoning as sign-in.test.tsx's renderSignIn(). */
async function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: Home,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    component: () => <h1>Profile</h1>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, profileRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Welcome to Home" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the welcome heading", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.getByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});

test("links to the profile page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Profile" }));

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

test("links to the settings page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("shows the signed-in coach's name once loaded", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("Coach Danny")).toBeInTheDocument();
});

test("shows no welcome-back line when the coach can't be loaded", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
});

test("shows no results list until the user types", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("filters players as the user types", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.type(screen.getByLabelText("Search players"), "sipho");

  expect(await screen.findByText("Sipho Dlamini")).toBeInTheDocument();
  expect(screen.queryByText("Amahle Nkosi")).not.toBeInTheDocument();
});

test("shows an empty state when no player matches", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.type(screen.getByLabelText("Search players"), "nobody");

  expect(await screen.findByText("No players found.")).toBeInTheDocument();
});
