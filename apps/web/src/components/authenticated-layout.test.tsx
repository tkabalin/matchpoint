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

function renderLayout(home: "/home" | "/me", path: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <AuthenticatedLayout home={home} />,
  });
  const childRoute = createRoute({
    getParentRoute: () => layoutRoute,
    path,
    component: () => <h1>Screen</h1>,
  });
  const routeTree = rootRoute.addChildren([layoutRoute.addChildren([childRoute])]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(<RouterProvider router={router} />);
}

/**
 * `_authenticated.tsx` is the one pathless layout route every real app screen sits
 * under, which is what makes this the guaranteed "every page" spot for the
 * persistent mark rather than something each screen has to remember to render.
 */
test("renders the persistent mark above whatever the route renders", async () => {
  renderLayout("/home", "/home");

  expect(await screen.findByRole("img", { name: "MatchPoint" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Screen" })).toBeInTheDocument();
});

// The same chrome serves both principals, so the destination has to come from the
// route that knows which one it guards, not from the layout.
test.each([
  ["/home" as const, "/home"],
  ["/me" as const, "/me"],
])("the mark links to %s", async (home, expected) => {
  renderLayout(home, home);

  expect(await screen.findByRole("link", { name: "MatchPoint home" })).toHaveAttribute(
    "href",
    expected,
  );
});
