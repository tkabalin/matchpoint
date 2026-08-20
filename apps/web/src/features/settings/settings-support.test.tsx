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

import { SettingsSupport } from "./settings-support";

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support",
    component: SettingsSupport,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([pageRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/support"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Support" });
}

test("links back to settings", async () => {
  const user = userEvent.setup();
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("all three rows are stubs, not interactive", async () => {
  await renderPage();

  expect(screen.getByText("Help & feedback")).toBeInTheDocument();
  expect(screen.getByText("Privacy policy / Terms")).toBeInTheDocument();
  expect(screen.getByText("App version")).toBeInTheDocument();
  expect(screen.getAllByText("soon")).toHaveLength(3);
});
