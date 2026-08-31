import type {
  PlayerOverview,
  PlayerRead,
  RallyStats,
  ServeSideStats,
  ServeStats,
} from "@matchpoint/api-client";
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
  username: "nksama001",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: "Strong two-handed backhand.",
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const DEFAULT_OVERVIEW: PlayerOverview = {
  all_time_record: { wins: 0, losses: 0 },
  season_record: { wins: 0, losses: 0 },
  form: null,
  hold_percentage: null,
  return_games_won: null,
  forced_to_unforced: null,
  recent_results: ["win", "win", "loss", "win", "win"],
};

const EMPTY_SERVE_SIDE: ServeSideStats = {
  breakdown: [],
  hero: null,
  metrics: [],
  outcome: { first_serve: null, second_serve: null },
  fault_mode: { first_serve: null, second_serve: null },
  return_outcome: { first_serve: [], second_serve: [] },
  trend: [],
};
const DEFAULT_SERVE_STATS: ServeStats = { serving: EMPTY_SERVE_SIDE, returning: EMPTY_SERVE_SIDE };

const EMPTY_STYLE_DETAIL = {
  wing: { forehand: 0, backhand: 0 },
  shot_type: [],
  court_zones: [],
  unusual_reasons: null,
};
const DEFAULT_RALLY_STATS: RallyStats = {
  errors_overall: null,
  errors_under_pressure: null,
  hero: null,
  won: 0,
  lost: 0,
  lost_by_shot: [],
  won_by_shot: [],
  outcome_mix: [],
  rally_length: [],
  shot_frequency: { you: [], opponents: [] },
  styles: {
    you: [
      { kind: "forced", label: "Forced (their pressure)", count: 0, detail: EMPTY_STYLE_DETAIL },
      {
        kind: "unforced",
        label: "Unforced (their free error)",
        count: 0,
        detail: EMPTY_STYLE_DETAIL,
      },
      { kind: "unusual", label: "Unusual (in your favor)", count: 0, detail: EMPTY_STYLE_DETAIL },
    ],
    opponents: [
      { kind: "forced", label: "Forced (your pressure)", count: 0, detail: EMPTY_STYLE_DETAIL },
      {
        kind: "unforced",
        label: "Unforced (your free error)",
        count: 0,
        detail: EMPTY_STYLE_DETAIL,
      },
      { kind: "unusual", label: "Unusual (against you)", count: 0, detail: EMPTY_STYLE_DETAIL },
    ],
  },
};

/**
 * Routes by pathname — this page fetches the player, their matches, and the
 * Serve tab's own analytics by default (Rally's, once a test switches to it).
 * A handler can read the request (method, body) for routes the edit flow
 * PATCHes. Analytics routes fall back to a generic empty payload so every
 * existing `stubFetch({...})` call in this file keeps working unchanged —
 * only a test that cares about specific stats numbers needs to override one.
 */
function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  const defaults: Record<string, () => Response> = {
    [`/api/players/${player.id}/analytics/overview`]: () => Response.json(DEFAULT_OVERVIEW),
    [`/api/players/${player.id}/analytics/serve`]: () => Response.json(DEFAULT_SERVE_STATS),
    [`/api/players/${player.id}/analytics/rally`]: () => Response.json(DEFAULT_RALLY_STATS),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[pathname] ?? defaults[pathname];
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

test("renders the player's name and avatar", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });

  await renderPlayerProfile();

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.getByText("AN")).toBeInTheDocument();
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
  const user = userEvent.setup({ delay: null });
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
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("link", { name: "Start match" }));

  expect(await screen.findByRole("heading", { name: "New match" })).toBeInTheDocument();
});

test("shows the all-time record and player details side by side", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  expect(await screen.findByText("Win/loss record")).toBeInTheDocument();
  expect(screen.getByText("All-time")).toBeInTheDocument();
  expect(screen.getByText("Player details")).toBeInTheDocument();
  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.getByText("Strong two-handed backhand.")).toBeInTheDocument();
});

test("the Notes button opens the notes sheet", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Notes" }));

  expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
});

test("opens on the Serve tab by default, with the scope panel and recent form above it", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  expect(await screen.findByText("Your serve")).toBeInTheDocument();
  expect(screen.getByText("All matches")).toBeInTheDocument();
  expect(await screen.findByText("Recent form · last 5")).toBeInTheDocument();
  expect(screen.queryByText("Point enders")).not.toBeInTheDocument();
});

test("switches to Rally when its toggle is clicked, scope panel and recent form stay put", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });
  await screen.findByText("Your serve");

  await user.click(screen.getByRole("button", { name: "Rally" }));

  expect(await screen.findByText("Point enders")).toBeInTheDocument();
  expect(screen.queryByText("Your serve")).not.toBeInTheDocument();
  expect(screen.getByText("All matches")).toBeInTheDocument();
  expect(screen.getByText("Recent form · last 5")).toBeInTheDocument();
});

test("Edit opens the sheet pre-filled with the player's current values", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: () => Response.json(player),
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
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
  const user = userEvent.setup({ delay: null });
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
  const user = userEvent.setup({ delay: null });
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

test("Delete player asks for confirmation before sending anything", async () => {
  const deletes: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") deletes.push(input.url);
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));

  expect(await screen.findByRole("heading", { name: "Delete Amahle?" })).toBeInTheDocument();
  expect(screen.getByText(/every match recorded against them/)).toBeInTheDocument();
  expect(deletes).toEqual([]);
});

test("Cancel on the delete step returns to the form without deleting", async () => {
  const deletes: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") deletes.push(input.url);
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));
  await screen.findByRole("heading", { name: "Delete Amahle?" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(await screen.findByRole("heading", { name: "Edit Amahle" })).toBeInTheDocument();
  expect(deletes).toEqual([]);
});

test("confirming Delete removes the player and returns to the roster", async () => {
  const deletes: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") {
        deletes.push(input.url);
        return new Response(null, { status: 204 });
      }
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));
  await screen.findByRole("heading", { name: "Delete Amahle?" });
  // Two buttons share the label across the two steps ("Delete player" also opens the
  // confirm step) — the confirm step's own button is the one still on screen here.
  await user.click(screen.getByRole("button", { name: "Delete player" }));

  await waitFor(() => expect(deletes).toHaveLength(1));
  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("a player already flagged as pending transfer skips straight to the explanation, no request sent", async () => {
  const deletes: string[] = [];
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") deletes.push(input.url);
      return Response.json({ ...player, has_transfer_code: true });
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));

  expect(
    await screen.findByRole("heading", { name: "Can't delete Amahle yet" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/transfer code waiting to be used/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /cancel.*code/i })).not.toBeInTheDocument();
  expect(deletes).toEqual([]);
});

test("a code created since the page loaded is caught by the request's own 409, same explanation", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") {
        return new Response(JSON.stringify({ detail: "Outstanding transfer code" }), {
          status: 409,
        });
      }
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));
  await screen.findByRole("heading", { name: "Delete Amahle?" });
  await user.click(screen.getByRole("button", { name: "Delete player" }));

  expect(
    await screen.findByRole("heading", { name: "Can't delete Amahle yet" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/transfer code waiting to be used/)).toBeInTheDocument();
});

// parseErrorMessage surfaces a string `detail` verbatim (see lib/parse-error.ts) —
// the generic fallback is only for a body with no usable detail, e.g. a bare network
// failure, not every non-2xx response.
test("an unexpected delete failure shows the server's own message", async () => {
  stubFetch({
    [`/api/players/${player.id}`]: (input) => {
      if (input.method === "DELETE") {
        return new Response(JSON.stringify({ detail: "boom" }), { status: 500 });
      }
      return Response.json(player);
    },
    "/api/matches": () => Response.json([]),
  });
  const user = userEvent.setup({ delay: null });
  await renderPlayerProfile();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Delete player" }));
  await screen.findByRole("heading", { name: "Delete Amahle?" });
  await user.click(screen.getByRole("button", { name: "Delete player" }));

  expect(await screen.findByText("boom")).toBeInTheDocument();
});
