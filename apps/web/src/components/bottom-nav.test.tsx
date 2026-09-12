import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { BottomNav } from "./bottom-nav";
import { PLAYER_TABS } from "./nav-tabs";
import type { NavTab } from "./nav-tabs";

function renderAt(path: string, paths: string[], tabs?: NavTab[]) {
  const rootRoute = createRootRoute();
  const routes = paths.map((routePath) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: () => (
        <div>
          <h1>{routePath}</h1>
          <BottomNav tabs={tabs} />
        </div>
      ),
    }),
  );
  const routeTree = rootRoute.addChildren(routes);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

const COACH_PATHS = ["/home", "/players", "/matches", "/stats"];
const PLAYER_PATHS = ["/me", "/me/matches", "/me/settings"];

test("renders all four coach tabs by default", async () => {
  renderAt("/home", COACH_PATHS);

  await screen.findByRole("heading", { name: "/home" });
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Players" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
});

test("marks the current tab active and no other", async () => {
  renderAt("/matches", COACH_PATHS);

  await screen.findByRole("heading", { name: "/matches" });
  expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Players" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Stats" })).not.toHaveAttribute("aria-current");
});

test("switches tabs on click", async () => {
  const user = userEvent.setup({ delay: null });
  renderAt("/home", COACH_PATHS);
  await screen.findByRole("heading", { name: "/home" });

  await user.click(screen.getByRole("link", { name: "Stats" }));

  expect(await screen.findByRole("heading", { name: "/stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toHaveAttribute("aria-current", "page");
});

// #203: a player's own nav is a different, smaller set — no roster, no Home
// dashboard, no squad-wide screens.
test("renders the player's three tabs instead, when given PLAYER_TABS", async () => {
  renderAt("/me", PLAYER_PATHS, PLAYER_TABS);

  await screen.findByRole("heading", { name: "/me" });
  expect(screen.getByRole("link", { name: "Me" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Players" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Stats" })).not.toBeInTheDocument();
});
