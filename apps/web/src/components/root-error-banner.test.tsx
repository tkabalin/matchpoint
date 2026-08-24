import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RootErrorBanner } from "./root-error-banner";

function ThrowingComponent(): never {
  throw new Error("boom");
}

function renderWithThrow() {
  const rootRoute = createRootRoute({ errorComponent: RootErrorBanner });
  const throwingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: ThrowingComponent,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([throwingRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows a reload banner instead of a blank screen when a route throws", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  renderWithThrow();

  expect(await screen.findByRole("alertdialog", { name: "Something went wrong." })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
});
