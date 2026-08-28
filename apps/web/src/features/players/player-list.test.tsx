import type { PlayerRead } from "@matchpoint/api-client";
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
import { afterEach, expect, test, vi } from "vitest";

import { PlayerList } from "./player-list";

// Annotated rather than inferred so tsc holds the fixture to the generated contract:
// an un-annotated literal happily describes a response the API cannot return.
const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/** Stubs the transport rather than the generated client: the client is what's under test.
 *
 * Takes a factory, not a Response: a body can be read only once, so a single instance
 * handed to every call would resolve a second request in the same test — a refetch, or
 * a retry — with an unusable body rather than the fixture set up here.
 */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders PlayerList inside a real (in-memory) router — its 401 branch links back
 * to sign-in, so router context is needed regardless of what the roster renders. */
async function renderPlayerList({ search = "", onSelect = vi.fn() } = {}) {
  // retry off so the error path resolves in one attempt instead of on Query's backoff.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: () => <PlayerList search={search} onSelect={onSelect} />,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign in</h1>,
  });
  const routeTree = rootRoute.addChildren([playersRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("renders the players the API returns", async () => {
  stubFetch(() => Response.json([player]));

  await renderPlayerList();

  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
  expect(screen.queryByText("Transfer pending")).not.toBeInTheDocument();
});

// #102 owns this indicator; #185 owns minting and cancelling the code itself, from
// the player's own profile.
test("flags a player whose transfer code is still out", async () => {
  stubFetch(() => Response.json([{ ...player, has_transfer_code: true }]));

  await renderPlayerList();

  expect(await screen.findByText("Transfer pending")).toBeInTheDocument();
});

test("the pending-transfer flag is part of the row, not a control of its own", async () => {
  stubFetch(() => Response.json([{ ...player, has_transfer_code: true }]));

  await renderPlayerList();

  await screen.findByText("Transfer pending");
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

test("requests the roster from the API's own origin", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayerList();

  expect(await screen.findByText("No players yet")).toBeInTheDocument();
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(String(request instanceof Request ? request.url : request)).toContain("/api/players");
});

test("groups players under their surname initial", async () => {
  stubFetch(() => Response.json([player]));

  await renderPlayerList();

  expect(await screen.findByRole("heading", { name: "N" })).toBeInTheDocument();
});

test("filters the roster by the search term", async () => {
  stubFetch(() => Response.json([player]));

  await renderPlayerList({ search: "zzz" });

  expect(await screen.findByText("No players found")).toBeInTheDocument();
  expect(screen.queryByText("Amahle Nkosi")).not.toBeInTheDocument();
});

test("reports a failed load instead of rendering an empty roster", async () => {
  stubFetch(() => new Response("nope", { status: 500 }));

  await renderPlayerList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load players.");
});

test("prompts to sign in again on a 401, instead of the generic error", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "Not signed in" }), { status: 401 }));

  await renderPlayerList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired.");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/");
});

// Tapping a row raises the action sheet rather than navigating: choosing between
// "view" and "start match" is the point. The sheet itself is covered in
// players-page.test.tsx, where it's actually rendered.
test("tapping a player hands it to the caller instead of navigating", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup({ delay: null });
  const { onSelect } = await renderPlayerList();

  await user.click(await screen.findByRole("button", { name: /Amahle Nkosi/ }));

  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: player.id }));
});
