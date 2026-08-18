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
import { afterEach, expect, test, vi } from "vitest";

import { MatchesPage } from "./matches-page";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders MatchesPage inside a real (in-memory) router — its bottom nav and
 * floating action are both links and need router context. */
function renderMatchesPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const routes = ["/matches", "/home", "/players", "/stats", "/new-match"].map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: MatchesPage }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/matches"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the page heading and the match list", async () => {
  stubFetch(() => Response.json([]));

  renderMatchesPage();

  expect(await screen.findByRole("heading", { name: "Matches", level: 1 })).toBeInTheDocument();
  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

// Rule: while a match is being captured the action resumes it rather than
// starting another. Nothing can be in progress yet, so this is the plus state.
test("offers starting a match when none is in progress", async () => {
  stubFetch(() => Response.json([]));

  renderMatchesPage();

  expect(await screen.findByRole("link", { name: "Start a match" })).toHaveAttribute(
    "href",
    "/new-match",
  );
  expect(screen.queryByText("Match in progress")).not.toBeInTheDocument();
});
