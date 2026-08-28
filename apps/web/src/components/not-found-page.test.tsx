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

import { NotFoundPage } from "./not-found-page";

/**
 * Exercises the actual wiring — a root route's `notFoundComponent`, the same
 * mechanism `__root.tsx` uses — rather than just rendering `NotFoundPage` in
 * isolation, so this would catch the option being set in the wrong place.
 */
async function renderAtUnmatchedPath() {
  const rootRoute = createRootRoute({ notFoundComponent: NotFoundPage });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const routeTree = rootRoute.addChildren([homeRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/this-page-does-not-exist"] }),
  });
  render(<RouterProvider router={router} />);
}

test("renders for a URL that matches no route", async () => {
  await renderAtUnmatchedPath();

  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
});

test("links back to home", async () => {
  const user = userEvent.setup({ delay: null });
  await renderAtUnmatchedPath();

  await user.click(await screen.findByRole("link", { name: "Back to home" }));

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});
