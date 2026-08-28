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

function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const routes = ["/home", "/players", "/matches", "/stats"].map((routePath) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: () => (
        <div>
          <h1>{routePath}</h1>
          <BottomNav />
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

test("renders all four tabs", async () => {
  renderAt("/home");

  await screen.findByRole("heading", { name: "/home" });
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Players" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
});

test("marks the current tab active and no other", async () => {
  renderAt("/matches");

  await screen.findByRole("heading", { name: "/matches" });
  expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Players" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Stats" })).not.toHaveAttribute("aria-current");
});

test("switches tabs on click", async () => {
  const user = userEvent.setup({ delay: null });
  renderAt("/home");
  await screen.findByRole("heading", { name: "/home" });

  await user.click(screen.getByRole("link", { name: "Stats" }));

  expect(await screen.findByRole("heading", { name: "/stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toHaveAttribute("aria-current", "page");
});
