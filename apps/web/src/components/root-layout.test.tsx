import {
  QueryClient,
  dehydrate,
  onlineManager,
  useIsRestoring,
  useQuery,
} from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { queryPersistOptions, removePersistedQueryCache } from "@/lib/query-persist";

import { RootLayout } from "./root-layout";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/**
 * A device with no connection. onlineManager is the half that matters: jsdom always
 * reports itself online, and Query pauses rather than fetches once told otherwise.
 */
function goOffline() {
  onlineManager.setOnline(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
}

function renderUnder(component: () => ReactNode, queryClient: QueryClient) {
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: RootLayout,
  });
  const childRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component });
  const router = createRouter({
    routeTree: rootRoute.addChildren([childRoute]),
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(<RouterProvider router={router} />);
}

/**
 * Reports both the query's data and whether the cache restore has finished, so a test
 * can assert on what is on screen at a point where a restore would already have shown.
 */
function probeFor(queryKey: string) {
  return function Probe() {
    const isRestoring = useIsRestoring();
    const { data } = useQuery({
      queryKey: [queryKey],
      queryFn: () =>
        fetch("/api/probe").then((response) => response.json() as Promise<{ source: string }>),
      retry: false,
    });

    return (
      <>
        <p>{isRestoring ? "restoring" : "restored"}</p>
        <p>{data?.source ?? "nothing cached"}</p>
      </>
    );
  };
}

/**
 * Writes a snapshot through the app's own persister, then waits for it to land: the
 * persister throttles writes, so its promise can resolve before the store has it.
 */
async function persistSnapshot(queryKey: string, buster: string) {
  const seed = new QueryClient();
  seed.setQueryData([queryKey], { source: "from cache" });
  const persisted: PersistedClient = {
    buster,
    timestamp: Date.now(),
    clientState: dehydrate(seed),
  };

  await queryPersistOptions.persister.persistClient(persisted);
  await vi.waitFor(
    async () => {
      expect(await queryPersistOptions.persister.restoreClient()).toStrictEqual(persisted);
    },
    { timeout: 5_000 },
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
  await removePersistedQueryCache();
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

  renderUnder(Probe, new QueryClient());

  expect(await screen.findByText("loaded")).toBeInTheDocument();
});

test("renders a read from the persisted cache with no connection", async () => {
  await persistSnapshot("offline-probe", queryPersistOptions.buster);
  goOffline();

  renderUnder(probeFor("offline-probe"), new QueryClient());

  expect(await screen.findByText("from cache")).toBeInTheDocument();
});

test("discards a snapshot an earlier app version persisted", async () => {
  await persistSnapshot("busted-probe", "0.0.0-earlier");
  goOffline();

  renderUnder(probeFor("busted-probe"), new QueryClient());

  // Waiting on the restore is what gives the assertion teeth: at this point the
  // previous test's snapshot would already be on screen.
  expect(await screen.findByText("restored")).toBeInTheDocument();
  expect(screen.getByText("nothing cached")).toBeInTheDocument();
});
