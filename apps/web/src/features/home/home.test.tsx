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

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders Home inside a real (in-memory) router — its Profile/Settings links need
 * router context, same reasoning as sign-in.test.tsx's renderSignIn(). A
 * QueryClientProvider is new as of this issue: Home now fetches the current coach. */
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
  stubFetch(() => new Response(null, { status: 401 }));
  await renderHome();

  expect(screen.getByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});

test("links to the profile page", async () => {
  stubFetch(() => new Response(null, { status: 401 }));
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Profile" }));

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

test("links to the settings page", async () => {
  stubFetch(() => new Response(null, { status: 401 }));
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("shows the signed-in coach's name once loaded", async () => {
  stubFetch(() =>
    Response.json({
      id: "3f1c2b4e-0000-4000-8000-0000000000c1",
      email: "coach@example.com",
      display_name: "Danny",
      created_at: "2026-08-11T09:00:00Z",
      updated_at: "2026-08-11T09:00:00Z",
    }),
  );
  await renderHome();

  expect(await screen.findByText("Coach Danny")).toBeInTheDocument();
});

test("shows no welcome-back line when the coach can't be loaded", async () => {
  stubFetch(() => new Response(null, { status: 401 }));
  await renderHome();

  expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
});
