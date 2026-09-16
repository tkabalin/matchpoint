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

import { SettingsApp } from "./settings-app";

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/app",
    component: SettingsApp,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/install",
    component: () => <h1>Install MatchPoint</h1>,
  });
  const routeTree = rootRoute.addChildren([pageRoute, settingsRoute, installRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/app"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "App" });
}

test("links back to settings", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("Install MatchPoint links to the real install guide", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Install MatchPoint" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});

// #208: no notifications system exists or is planned, so the stub row that
// used to promise one "soon" was removed rather than left waiting on nothing.
test("has no Notifications row", async () => {
  await renderPage();

  expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
});

// Dark mode is deactivated: no Appearance row to offer a toggle from any more.
test("has no Appearance row", async () => {
  await renderPage();

  expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
});
