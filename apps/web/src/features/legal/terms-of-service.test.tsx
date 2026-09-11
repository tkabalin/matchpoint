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
import { expect, test } from "vitest";

import { TermsOfService } from "./terms-of-service";

test("renders a placeholder, not the final terms text", async () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const termsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/terms",
    component: TermsOfService,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([termsRoute, signInRoute]),
    history: createMemoryHistory({ initialEntries: ["/terms"] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
  expect(screen.getByText(/being finalised/)).toBeInTheDocument();
});
