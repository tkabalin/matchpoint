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
import { expect, test } from "vitest";

import { Settings } from "./settings";

/** Renders Settings inside a real (in-memory) router — its category links and back
 * arrow both need router context. Each destination is a bare stub heading; the
 * destination pages themselves have their own test files. */
async function renderSettings() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: Settings,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const matchDefaultsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/match-defaults",
    component: () => <h1>Match Defaults</h1>,
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/account",
    component: () => <h1>Account & Security</h1>,
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/app",
    component: () => <h1>App</h1>,
  });
  const supportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support",
    component: () => <h1>Support</h1>,
  });
  const routeTree = rootRoute.addChildren([
    settingsRoute,
    homeRoute,
    matchDefaultsRoute,
    accountRoute,
    appRoute,
    supportRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Settings" });
}

test("links back to home", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("link", { name: "Back to home" }));

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test.each([
  ["Match Defaults", "Match Defaults"],
  ["Account & Security", "Account & Security"],
  ["App", "App"],
  ["Support", "Support"],
])("the %s row links to its category page", async (rowName, headingName) => {
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("link", { name: rowName }));

  expect(await screen.findByRole("heading", { name: headingName })).toBeInTheDocument();
});

test("offers Sign Out at the root, for fast single-tap access", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("Sign out?")).toBeInTheDocument();
});
