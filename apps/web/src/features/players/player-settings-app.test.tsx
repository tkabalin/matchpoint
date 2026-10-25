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

import { PlayerSettingsApp } from "./player-settings-app";

async function renderApp() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings/app",
    component: PlayerSettingsApp,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings",
    component: () => <h1>Settings</h1>,
  });
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/install",
    component: () => <h1>Install MatchPoint</h1>,
  });
  const routeTree = rootRoute.addChildren([appRoute, settingsRoute, installRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me/settings/app"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "App" });
}

// #275: a player had no reachable path to the install guide before this row
// existed — the coach's own `/install` is not a route a player session can load.
test("links to the player's own install guide route", async () => {
  const user = userEvent.setup({ delay: null });
  await renderApp();

  await user.click(screen.getByRole("link", { name: "Install MatchPoint" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});

test("goes back to the settings menu", async () => {
  const user = userEvent.setup({ delay: null });
  await renderApp();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});
