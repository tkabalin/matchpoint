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

import { SettingsMatchDefaults } from "./settings-match-defaults";

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/match-defaults",
    component: SettingsMatchDefaults,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([pageRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/match-defaults"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Match Defaults" });
}

test("links back to settings", async () => {
  const user = userEvent.setup();
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("both rows are stubs, not interactive", async () => {
  await renderPage();

  expect(screen.getByText("Default surface")).toBeInTheDocument();
  expect(screen.getByText("Default sets format")).toBeInTheDocument();
  expect(screen.getAllByText("soon")).toHaveLength(2);
  expect(screen.queryByRole("link", { name: /Default/ })).not.toBeInTheDocument();
});
