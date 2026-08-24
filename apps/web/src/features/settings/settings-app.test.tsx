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
  const user = userEvent.setup();
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("Install MatchPoint links to the real install guide", async () => {
  const user = userEvent.setup();
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Install MatchPoint" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});

test("Notifications is still a stub, not interactive", async () => {
  await renderPage();

  expect(screen.getByText("Notifications")).toBeInTheDocument();
  expect(screen.getByText("soon")).toBeInTheDocument();
});

test("Appearance toggles between light and dark, and persists the choice", async () => {
  localStorage.removeItem("matchpoint:theme");
  const user = userEvent.setup();
  await renderPage();

  expect(document.documentElement).not.toHaveClass("dark");

  await user.click(screen.getByRole("button", { name: "Dark" }));

  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem("matchpoint:theme")).toBe("dark");

  await user.click(screen.getByRole("button", { name: "Light" }));

  expect(document.documentElement).not.toHaveClass("dark");
  expect(localStorage.getItem("matchpoint:theme")).toBe("light");
});
