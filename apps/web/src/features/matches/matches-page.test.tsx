import type { MatchRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { getDeviceId } from "@/lib/device-id";

import { MatchesPage } from "./matches-page";

const match: MatchRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  player_id: "3f1c2b4e-0000-4000-8000-000000000001",
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/** Routes by pathname, method-aware — needed once a test drives an actual DELETE. */
function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[pathname];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler(input));
    }),
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
  stubFetch({ "/api/matches": () => Response.json([]) });

  renderMatchesPage();

  expect(await screen.findByRole("heading", { name: "Matches", level: 1 })).toBeInTheDocument();
  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

// Rule: while a match is being captured the action resumes it rather than
// starting another. Nothing can be in progress yet, so this is the plus state.
test("offers starting a match when none is in progress", async () => {
  stubFetch({ "/api/matches": () => Response.json([]) });

  renderMatchesPage();

  expect(await screen.findByRole("link", { name: "Start a match" })).toHaveAttribute(
    "href",
    "/new-match",
  );
  expect(screen.queryByText("Match in progress")).not.toBeInTheDocument();
});

test("tapping a match opens its actions", async () => {
  stubFetch({ "/api/matches": () => Response.json([match]) });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));

  expect(await screen.findByRole("heading", { name: "vs T. Naidoo" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete match" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
});

test("Cancel closes the sheet without deleting", async () => {
  const deletes: string[] = [];
  stubFetch({
    "/api/matches": () => Response.json([match]),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") deletes.push(input.url);
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("heading", { name: "vs T. Naidoo" })).not.toBeInTheDocument();
  expect(deletes).toEqual([]);
});

test("Delete match asks for confirmation before sending anything", async () => {
  const deletes: string[] = [];
  stubFetch({
    "/api/matches": () => Response.json([match]),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") deletes.push(input.url);
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));

  expect(await screen.findByRole("heading", { name: "Delete this match?" })).toBeInTheDocument();
  expect(deletes).toEqual([]);
});

test("confirming deletes the match and it leaves the list", async () => {
  const deletes: string[] = [];
  let listed = [match];
  stubFetch({
    "/api/matches": () => Response.json(listed),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") {
        deletes.push(input.url);
        listed = [];
        return new Response(null, { status: 204 });
      }
      return Response.json(listed);
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));
  await screen.findByRole("heading", { name: "Delete this match?" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));

  await waitFor(() => expect(deletes).toHaveLength(1));
  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

test("a failed delete says so and keeps the match", async () => {
  stubFetch({
    "/api/matches": () => Response.json([match]),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") return new Response("nope", { status: 500 });
      return Response.json([match]);
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));
  await screen.findByRole("heading", { name: "Delete this match?" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));

  expect(await screen.findByText("Could not delete that match.")).toBeInTheDocument();
  // The sheet stays open on the confirm step rather than closing on a failure — a
  // closed sheet would be the visible sign the match was gone.
  expect(screen.getByRole("heading", { name: "Delete this match?" })).toBeInTheDocument();
});

test("the delete names this device, so its own capture claim cannot block it", async () => {
  const sentDeviceIds: (string | null)[] = [];
  stubFetch({
    "/api/matches": () => Response.json([match]),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") {
        sentDeviceIds.push(new URL(input.url).searchParams.get("device_id"));
        return new Response(null, { status: 204 });
      }
      return Response.json([match]);
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));
  await screen.findByRole("heading", { name: "Delete this match?" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));

  await waitFor(() => expect(sentDeviceIds).toEqual([getDeviceId()]));
});

test("a match being captured on another device says so", async () => {
  stubFetch({
    "/api/matches": () => Response.json([match]),
    [`/api/matches/${match.id}`]: (input) => {
      if (input.method === "DELETE") {
        // The server's own wording, rendered as it stands: the refusal names a
        // situation only the server can see, so local copy for it would go stale.
        return Response.json(
          { detail: "Match is being captured on another device" },
          { status: 409 },
        );
      }
      return Response.json([match]);
    },
  });
  const user = userEvent.setup();
  renderMatchesPage();

  await user.click(await screen.findByRole("button", { name: /vs T\. Naidoo/ }));
  await screen.findByRole("heading", { name: "vs T. Naidoo" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));
  await screen.findByRole("heading", { name: "Delete this match?" });
  await user.click(screen.getByRole("button", { name: "Delete match" }));

  expect(await screen.findByText("Match is being captured on another device")).toBeInTheDocument();
});
