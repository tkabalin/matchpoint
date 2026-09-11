import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
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

function renderRouter(router: ReturnType<typeof buildRouter>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// Mounted at the real `/privacy` path rather than an invented one: `Link`'s
// `to` prop is typed against the app's actual generated route tree even
// inside a test's own hand-built one, so a `<Link>` below can only target a
// path that really exists.
function buildRouter(initialEntries: string[]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: () => <LegalPage title="Test Policy">Body text</LegalPage>,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const entryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/entry",
    component: () => (
      <>
        <h1>Entry point</h1>
        <Link to="/privacy">Go to policy</Link>
      </>
    ),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([pageRoute, signInRoute, entryRoute]),
    history: createMemoryHistory({ initialEntries }),
  });
}

test("shows the title and body", async () => {
  renderRouter(buildRouter(["/privacy"]));

  expect(await screen.findByRole("heading", { name: "Test Policy" })).toBeInTheDocument();
  expect(screen.getByText("Body text")).toBeInTheDocument();
});

// The two real callers (Settings, sign-up) are both places a coach actually
// navigated from, so Back should pop that real history rather than jump to
// a fixed destination — unlike most of this app's other `back=` props.
test("Back pops real history back to wherever the coach came from", async () => {
  const user = userEvent.setup({ delay: null });
  renderRouter(buildRouter(["/entry"]));
  await user.click(await screen.findByRole("link", { name: "Go to policy" }));
  await screen.findByRole("heading", { name: "Test Policy" });

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(await screen.findByRole("heading", { name: "Entry point" })).toBeInTheDocument();
});

// A direct/deep link (someone opens /privacy with no referring page) has no
// history to pop — Back falls back to "/" rather than doing nothing.
test("Back falls back to sign-in for a direct link with nothing to pop", async () => {
  const user = userEvent.setup({ delay: null });
  renderRouter(buildRouter(["/privacy"]));
  await screen.findByRole("heading", { name: "Test Policy" });

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});
