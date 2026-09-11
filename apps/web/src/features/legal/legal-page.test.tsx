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

import { LegalPage } from "./legal-page";

async function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/test-policy",
    component: () => <LegalPage title="Test Policy">Body text</LegalPage>,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute, signInRoute]),
    history: createMemoryHistory({ initialEntries: ["/test-policy"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Test Policy" });
}

test("shows the title and body", async () => {
  await renderPage();

  expect(screen.getByRole("heading", { name: "Test Policy" })).toBeInTheDocument();
  expect(screen.getByText("Body text")).toBeInTheDocument();
});

test("links back to sign in", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to sign in" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});
