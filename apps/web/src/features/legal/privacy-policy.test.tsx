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

import { PrivacyPolicy } from "./privacy-policy";

test("renders a placeholder, not the final policy text", async () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: PrivacyPolicy,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([privacyRoute, signInRoute]),
    history: createMemoryHistory({ initialEntries: ["/privacy"] }),
  });
  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
  expect(screen.getByText(/being finalised/)).toBeInTheDocument();
});
