import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AuthenticatedLayout } from "./authenticated-layout";

/**
 * `_authenticated.tsx` is the one pathless layout route every real app screen sits
 * under, which is what makes this the guaranteed "every page" spot for the
 * persistent mark rather than something each screen has to remember to render.
 */
test("renders the persistent mark above whatever the route renders", async () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: AuthenticatedLayout,
  });
  const childRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const routeTree = rootRoute.addChildren([layoutRoute.addChildren([childRoute])]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });

  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("img", { name: "MatchPoint" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
});
