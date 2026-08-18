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

import { InstallAppNudge } from "./install-app-nudge";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function renderNudge() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    // The nudge can render nothing (dismissed, or already installed), so this always-
    // present sibling is what the tests wait on to know the router has settled.
    component: () => (
      <div data-testid="home">
        <InstallAppNudge />
      </div>
    ),
  });
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/install",
    component: () => <h1>Install MatchPoint</h1>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, installRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByTestId("home");
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("shows the nudge when not dismissed and not installed", async () => {
  stubMatchMedia(false);

  await renderNudge();

  expect(screen.getByText("Install MatchPoint")).toBeInTheDocument();
});

test("hides itself once dismissed, and stays hidden across a remount", async () => {
  stubMatchMedia(false);
  const user = userEvent.setup();
  await renderNudge();

  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText("Install MatchPoint")).not.toBeInTheDocument();

  await renderNudge();
  expect(screen.queryByText("Install MatchPoint")).not.toBeInTheDocument();
});

test("never shows once the app is already installed", async () => {
  stubMatchMedia(true);

  await renderNudge();

  expect(screen.queryByText("Install MatchPoint")).not.toBeInTheDocument();
});

test("'See how' links to the full install guide", async () => {
  stubMatchMedia(false);
  const user = userEvent.setup();
  await renderNudge();

  await user.click(screen.getByRole("link", { name: "See how" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});
