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

import { APP_VERSION } from "@/lib/app-version";

import { PlayerSettingsSupport } from "./player-settings-support";

async function renderSupport() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const supportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings/support",
    component: PlayerSettingsSupport,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([supportRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me/settings/support"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Support" });
}

test("links to the public privacy and terms pages and shows the app version", async () => {
  await renderSupport();

  expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
});

// The coach's Help & feedback answers questions about a roster, transfer codes and
// deleting a coach account — the wrong document for a player, not a missing row.
test("offers no Help & feedback row", async () => {
  await renderSupport();

  expect(screen.queryByRole("link", { name: "Help & feedback" })).not.toBeInTheDocument();
});

test("goes back to the settings menu", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSupport();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});
