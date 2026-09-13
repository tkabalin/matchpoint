import type { PlayerRead, RallyStats, ServeStats, SquadMemberStats } from "@matchpoint/api-client";
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

import { getLastViewedPlayerId } from "@/lib/last-viewed-player";

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

const EMPTY_SERVE_SIDE = {
  breakdown: [],
  fault_mode: { first_serve: null, second_serve: null },
  hero: null,
  metrics: [],
  outcome: { first_serve: null, second_serve: null },
  return_outcome: { first_serve: [], second_serve: [] },
  trend: [],
};

const emptyServeStats: ServeStats = { serving: EMPTY_SERVE_SIDE, returning: EMPTY_SERVE_SIDE };

const emptyRallyStats: RallyStats = {
  average_rally_length: { won: null, lost: null },
  errors_overall: null,
  errors_under_pressure: null,
  hero: null,
  lost: 0,
  lost_by_shot: [],
  outcome_mix: [],
  rally_length: [],
  shot_frequency: { you: [], opponents: [] },
  styles: { you: [], opponents: [] },
  won: 0,
  won_by_shot: [],
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

/** Routes by pathname, for a test that needs the roster, the squad-stats endpoint
 *  and a card's own per-player analytics calls to each answer something different. */
function stubFetchByPath(handlers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = Object.entries(handlers).find(([path]) => pathname.includes(path))?.[1];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

/** Renders PlayerList inside a real (in-memory) router — its 401 branch links back
 * to sign-in, and each card links to the profile and to new-match. */
async function renderPlayerList({ search = "" } = {}) {
  // retry off so the error path resolves in one attempt instead of on Query's backoff.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: () => <PlayerList search={search} />,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign in</h1>,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match/$playerId",
    component: () => <h1>New Match</h1>,
  });
  const routeTree = rootRoute.addChildren([playersRoute, signInRoute, profileRoute, newMatchRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
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

test("the pending-transfer flag sits beside the name, not as a control of its own", async () => {
  stubFetch(() => Response.json([{ ...player, has_transfer_code: true }]));

  await renderPlayerList();

  await screen.findByText("Transfer pending");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
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

// Each card carries its own two actions rather than raising a picker sheet —
// #262's whole point. Both are real links, not a button that opens something else.
test("each card offers a link to view stats and a separate link to start a match", async () => {
  stubFetch(() => Response.json([player]));

  await renderPlayerList();

  await screen.findByText("Amahle Nkosi");
  expect(screen.getByRole("link", { name: "View stats" })).toHaveAttribute(
    "href",
    `/players/${player.id}`,
  );
  expect(screen.getByRole("link", { name: "Start match" })).toHaveAttribute(
    "href",
    `/new-match/${player.id}`,
  );
});

// The header itself is not a link — "View stats" is the one way in, so the
// card doesn't offer a second, chevron-implied one that does the same thing.
test("the header is not a link, only View stats and Start match are", async () => {
  stubFetch(() => Response.json([player]));
  await renderPlayerList();

  await screen.findByText("Amahle Nkosi");
  expect(screen.getByRole("group", { name: "Amahle Nkosi's card" })).toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

test("View stats navigates to the player's profile and records last-viewed", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup({ delay: null });
  await renderPlayerList();

  await user.click(await screen.findByRole("link", { name: "View stats" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
  expect(getLastViewedPlayerId()).toBe(player.id);
});

test("tapping start match reaches new-match without touching the profile route", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup({ delay: null });
  await renderPlayerList();

  await user.click(await screen.findByRole("link", { name: "Start match" }));

  expect(await screen.findByRole("heading", { name: "New Match" })).toBeInTheDocument();
});

// A player with nothing logged yet shows only the attention flag — no metrics
// section, and no per-player analytics requests fired for it.
test("a player with no logged matches shows no metrics section", async () => {
  const neverPlayed: SquadMemberStats = {
    player_id: player.id,
    matches_logged_this_period: 0,
    last5_results: [],
    period_forced_to_unforced_ratio: null,
    period_forced_errors_induced: 0,
    period_unforced_errors: 0,
    period_forced_errors_suffered: 0,
    period_points_won: 0,
    period_points_lost: 0,
    period_first_serve_in_percent: null,
    period_record: { wins: 0, losses: 0 },
    current_streak: null,
    days_since_last_match: null,
    last5_stats: {
      first_serve_in_percent: null,
      return_in_percent: null,
      forced_to_unforced_ratio: null,
      forced_errors_induced: 0,
      unforced_errors: 0,
      forced_errors_suffered: 0,
      points_won: 0,
      points_lost: 0,
    },
    tracked_stats: [],
  };
  stubFetchByPath({
    "/api/players": () => Response.json([player]),
    "/api/squad/analytics/members": () => Response.json([neverPlayed]),
  });

  await renderPlayerList();

  await screen.findByText("Amahle Nkosi");
  expect(screen.getByText("No matches logged yet")).toBeInTheDocument();
  expect(screen.queryByText("All matches")).not.toBeInTheDocument();
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/analytics/serve")),
  ).toBe(false);
});

// A real attention flag (not the always-empty fixture this row used to read)
// replaces the row's plain form figure — same reasoning as home.tsx's own
// attention card, sourced from the same `/squad/analytics/members` payload.
test("shows a real attention flag, and renders the metrics section once matches exist", async () => {
  const flagged: SquadMemberStats = {
    player_id: player.id,
    matches_logged_this_period: 5,
    last5_results: ["loss", "loss", "loss", "win", "win"],
    period_forced_to_unforced_ratio: 1,
    period_forced_errors_induced: 30,
    period_unforced_errors: 30,
    period_forced_errors_suffered: 20,
    period_points_won: 100,
    period_points_lost: 90,
    period_first_serve_in_percent: 60,
    period_record: { wins: 1, losses: 4 },
    current_streak: { outcome: "loss", length: 3 },
    days_since_last_match: 1,
    last5_stats: {
      first_serve_in_percent: 60,
      return_in_percent: 70,
      forced_to_unforced_ratio: 1,
      forced_errors_induced: 12,
      unforced_errors: 12,
      forced_errors_suffered: 8,
      points_won: 40,
      points_lost: 35,
    },
    tracked_stats: [],
  };
  stubFetchByPath({
    "/api/players": () => Response.json([player]),
    "/api/squad/analytics/members": () => Response.json([flagged]),
    "/analytics/serve": () => Response.json(emptyServeStats),
    "/analytics/rally": () => Response.json(emptyRallyStats),
  });

  await renderPlayerList();

  expect(await screen.findByText("3-match losing streak")).toBeInTheDocument();
  expect(await screen.findByText("All matches")).toBeInTheDocument();
});
