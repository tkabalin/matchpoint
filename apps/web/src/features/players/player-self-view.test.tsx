import type {
  PlayerOverview,
  PlayerSelfRead,
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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { validateStatsFiltersSearch } from "@/lib/analytics/filter-options";

import { PlayerSelfView } from "./player-self-view";

const player: PlayerSelfRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
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

/** Same reasoning as player-profile.test.tsx's own stubFetch: analytics routes fall
 *  back to a generic empty payload so most tests need only stub the player fetch
 *  and /api/matches. Built on GET /auth/player/me, never GET /players/{id} — a
 *  player session 401s on that coach-only route even for its own id (#203). */
function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  const defaults: Record<string, () => Response> = {
    "/api/auth/player/me": () => Response.json(player),
    "/api/matches": () => Response.json([]),
    [`/api/players/${player.id}/analytics/overview`]: () => Response.json(DEFAULT_OVERVIEW),
    [`/api/players/${player.id}/analytics/serve`]: () => Response.json(DEFAULT_SERVE_STATS),
    [`/api/players/${player.id}/analytics/rally`]: () => Response.json(DEFAULT_RALLY_STATS),
    [`/api/players/${player.id}/analytics/opponents`]: () => Response.json([]),
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

async function renderSelfView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playerRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_player",
    component: () => <Outlet />,
  });
  const meRoute = createRoute({
    getParentRoute: () => playerRoute,
    path: "/me",
    component: PlayerSelfView,
    validateSearch: validateStatsFiltersSearch,
  });
  const routeTree = rootRoute.addChildren([playerRoute.addChildren([meRoute])]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me"] }),
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

test("renders the player's own name and avatar", async () => {
  stubFetch({});

  await renderSelfView();

  expect(await screen.findByRole("heading", { name: "Amahle Nkosi" })).toBeInTheDocument();
  expect(screen.getByText("AN")).toBeInTheDocument();
});

test("shows the record and details cards, with no Edit button", async () => {
  stubFetch({});

  await renderSelfView();

  await screen.findByRole("heading", { name: "Amahle Nkosi" });
  expect(screen.getByText("Player details")).toBeInTheDocument();
  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
});

test("has no Start match button, no Notes button, and no coach-only affordance", async () => {
  stubFetch({});

  await renderSelfView();

  await screen.findByRole("heading", { name: "Amahle Nkosi" });
  expect(screen.queryByRole("link", { name: "Start match" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Notes" })).not.toBeInTheDocument();
});

test("opens on the Serve tab, and switches to Rally", async () => {
  stubFetch({});
  const user = userEvent.setup({ delay: null });
  await renderSelfView();
  await screen.findByRole("heading", { name: "Amahle Nkosi" });

  expect(await screen.findByText("Your serve")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Rally" }));

  expect(await screen.findByText("Point enders")).toBeInTheDocument();
});
