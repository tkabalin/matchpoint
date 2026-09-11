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

import { SettingsFaq } from "./settings-faq";

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const faqRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support/faq",
    component: SettingsFaq,
  });
  const supportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/support",
    component: () => <h1>Support</h1>,
  });
  const routeTree = rootRoute.addChildren([faqRoute, supportRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/support/faq"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Help & feedback" });
}

test("answers the questions this app's own design raises", async () => {
  await renderPage();

  expect(screen.getByText("What happens if I delete my account?")).toBeInTheDocument();
  expect(screen.getByText("Why does capture work with no signal?")).toBeInTheDocument();
  expect(screen.getByText("What is a transfer code?")).toBeInTheDocument();
});

test("links back to support", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to support" }));

  expect(await screen.findByRole("heading", { name: "Support" })).toBeInTheDocument();
});
