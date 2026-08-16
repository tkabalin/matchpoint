import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RootLayout } from "./root-layout";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("supplies a QueryClient every route can use, with no provider of its own", async () => {
  stubFetch(() => Response.json({ ok: true }));

  // A child that calls useQuery directly, unwrapped — if RootLayout stopped providing
  // a QueryClient, this throws instead of rendering "loaded".
  function Probe() {
    const { isPending } = useQuery({
      queryKey: ["probe"],
      queryFn: () => fetch("/api/probe").then((response) => response.json()),
    });
    return <p>{isPending ? "loading" : "loaded"}</p>;
  }

  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: RootLayout,
  });
  const probeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Probe });
  const routeTree = rootRoute.addChildren([probeRoute]);
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);

  expect(await screen.findByText("loaded")).toBeInTheDocument();
});
