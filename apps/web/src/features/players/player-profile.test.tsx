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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerProfile } from "./player-profile";

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: "Strong two-handed backhand.",
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/**
 * Routes by pathname — this page fetches both the player and their matches. A
 * handler can read the request (method, body) for routes the edit flow PATCHes.
 */
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

async function renderPlayerProfile(playerId = player.id) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  // Nested under a pathless `_authenticated` layout, matching the real route tree —
  // PlayerProfile resolves its params via `getRouteApi("/_authenticated/players/$playerId")`,
  // which needs an active match at that exact route id.
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <Outlet />,
  });
  const homeRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/home",
    component: () => <h1>Welcome to Home</h1>,
  });
  const profileRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/players/$playerId",
    component: PlayerProfile,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/new-match/$playerId",
    component: () => <h1>New match</h1>,
  });
  // Where the not-found and expired-session states send the coach.
  const rosterRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/players",
    component: () => <h1>Players</h1>,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign in</h1>,
  });
  const routeTree = rootRoute.addChildren([
    signInRoute,
    authenticatedRoute.addChildren([homeRoute, profileRoute, newMatchRoute, rosterRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/players/${playerId}`] }),
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

test("renders the player's name and static fields", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.getByText("AN")).toBeInTheDocument();
  // The static fields sit in the Overview tab's details panel, which loads with it.
  expect(await screen.findByText("2008-04-12")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  expect(screen.getByText("Strong two-handed backhand.")).toBeInTheDocument();
});

test("shows a placeholder for unset fields", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () =>
      Response.json({ ...player, date_of_birth: null, dominant_hand: null, notes: null }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  await screen.findByRole("heading", { name: "Amahle Nkosi" });
  expect(await screen.findAllByText("—")).toHaveLength(3);
});

test("lists that player's matches on the Matches tab", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () =>
      Response.json([
        {
          id: "3f1c2b4e-0000-4000-8000-00000000ma01",
          player_id: player.id,
          opponent_name: "T. Naidoo",
          played_on: "2026-08-10",
          surface: "hard",
          event: null,
          scoring_system: "traditional",
          created_at: "2026-08-11T09:00:00Z",
          updated_at: "2026-08-11T09:00:00Z",
        },
      ]),
  });

  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("tab", { name: "Matches" }));

  expect(await screen.findByText("vs T. Naidoo")).toBeInTheDocument();
});

// The API answers 404 rather than 403 for another coach's player, so a 403 cannot
// confirm the id exists. The copy has to keep that property (#78).
test("says not found for a player id that isn't the coach's", async () => {
  stubFetch({
    // Body shape matches the real route: FastAPI's HTTPException emits
    // {"detail": ...}, and the error interceptor can only attach the status to an
    // object error, so a bodiless stub would silently test the generic branch.
    [`/api/players/${player.id}`]: () =>
      new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByText("Player not found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to roster" })).toHaveAttribute("href", "/players");
  expect(screen.queryByText(/permission/i)).not.toBeInTheDocument();
});

test("sends the coach back to sign in on a 401, not to the roster", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () =>
      new Response(JSON.stringify({ detail: "Not signed in" }), { status: 401 }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByText("Your session has expired")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/");
  expect(screen.queryByText("Player not found")).not.toBeInTheDocument();
});

test("falls back to a generic message for an unexpected failure", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () =>
      new Response(JSON.stringify({ detail: "boom" }), { status: 500 }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByText("Could not load that player.")).toBeInTheDocument();
});

// Regression: PlayerLoadError's move off `Alert` onto `Empty` (#78) dropped the
// role="alert" the original error carried — caught by e2e/smoke.spec.ts, which
// exercises exactly this branch against a live server with no API behind it.
test("announces a load failure as an alert, for every branch", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () =>
      new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 }),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByRole("alert")).toHaveTextContent("Player not found");
});

test("links back to home", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("link", { name: "Back to home" }));

  expect(await screen.findByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});

test("links to the match setup screen", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("link", { name: "Start match" }));

  expect(await screen.findByRole("heading", { name: "New match" })).toBeInTheDocument();
});

test("switches to a tab's content when its trigger is clicked", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  expect(screen.queryByRole("group", { name: "Serve or return" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Serve" }));

  expect(await screen.findByText("Hold % (service games won)")).toBeInTheDocument();
});

test("H2H tab lists opponents, drills into one, and comes back", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("tab", { name: "H2H" }));

  expect(await screen.findByText("A. Torres")).toBeInTheDocument();
  expect(screen.getByText("n=4 · 3–1 · 67%")).toBeInTheDocument();
  // Under the threshold a rate would be noise, so only the raw record is shown.
  expect(screen.getByText("n=2 · 1–1 · too few for a rate")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /A. Torres/ }));

  expect(await screen.findByRole("heading", { name: "vs A. Torres" })).toBeInTheDocument();
  expect(screen.getByText(/Her backhand under pressure/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back to opponents" }));

  expect(await screen.findByText("A. Torres")).toBeInTheDocument();
});

test("Edit opens the sheet pre-filled with the player's current values", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(await screen.findByRole("heading", { name: "Edit Amahle" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "First name" })).toHaveValue("Amahle");
  expect(screen.getByRole("textbox", { name: "Last name" })).toHaveValue("Nkosi");
  expect(screen.getByLabelText("Date of birth")).toHaveValue("2008-04-12");
});

test("saving Edit PATCHes only the field that changed", async () => {
  const patches: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: async (input) => {
      if (input.method === "PATCH") {
        patches.push(await input.text());
        return Response.json({ ...player, last_name: "Khumalo" });
      }
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  const lastName = await screen.findByRole("textbox", { name: "Last name" });
  await user.clear(lastName);
  await user.type(lastName, "Khumalo");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(patches).toHaveLength(1));
  expect(JSON.parse(patches[0]!)).toEqual({ last_name: "Khumalo" });
});

test("saving Edit with nothing changed just closes, no request sent", async () => {
  const patches: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: async (input) => {
      if (input.method === "PATCH") patches.push(await input.text());
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup();
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByRole("heading", { name: "Edit Amahle" });
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Edit Amahle" })).not.toBeInTheDocument(),
  );
  expect(patches).toEqual([]);
});
