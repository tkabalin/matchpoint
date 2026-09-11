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
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { APP_VERSION } from "@/lib/app-version";

import { SettingsSupport } from "./settings-support";

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support",
    component: SettingsSupport,
  });
  const faqRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support/faq",
    component: () => <h1>FAQ</h1>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([pageRoute, faqRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/support"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Support" });
}

test("links back to settings", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

// #193: Help & feedback is a real link now, not a stub.
test("Help & feedback links to the FAQ page", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Help & feedback" }));

  expect(await screen.findByRole("heading", { name: "FAQ" })).toBeInTheDocument();
});

test("privacy/terms is still a stub, not interactive", async () => {
  await renderPage();

  expect(screen.getByText("Privacy policy / Terms")).toBeInTheDocument();
  expect(screen.getAllByText("soon")).toHaveLength(1);
});

// #195: real content behind the third row now — the build's own version,
// not a stub.
test("shows the real app version, not a stub", async () => {
  await renderPage();

  expect(screen.getByText("App version")).toBeInTheDocument();
  expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
});
