import type { PlayerRead, SquadMemberStats, SquadTrendPoint } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { StatsPage } from "./stats-page";

function player(id: string, firstName: string, lastName: string): PlayerRead {
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    username: `${firstName}${lastName}`.toLowerCase(),
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: "coach-1",
    has_transfer_code: false,
    photo_url: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  };
}

function member(overrides: Partial<SquadMemberStats> & { player_id: string }): SquadMemberStats {
  return {
    matches_logged_this_period: 10,
    last5_results: ["win", "win", "loss", "win", "win"],
    period_forced_to_unforced_ratio: 1,
    period_forced_errors_induced: 30,
    period_unforced_errors: 30,
    period_forced_errors_suffered: 20,
    period_points_won: 100,
    period_points_lost: 90,
    period_first_serve_in_percent: 60,
    period_record: { wins: 0, losses: 0 },
    current_streak: null,
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
    ...overrides,
  };
}

// index 0 (8–2, 80%) beats index 2 (1–8, 11%) on win %, but index 2 beats
// index 1 (5–5, 0.7) on Forced:Unforced (0.9) — a real reordering between
// metrics. Index 3 (1 match, 1–0, 100%) is no longer excluded by any
// threshold — it simply ranks on its own numbers like everyone else.
const players: PlayerRead[] = [
  player("p0", "Alex", "Chen"),
  player("p1", "Priya", "Singh"),
  player("p2", "Sam", "Rivera"),
  player("p3", "Rookie", "Ross"),
];

const squadStats: SquadMemberStats[] = [
  member({
    player_id: "p0",
    period_record: { wins: 8, losses: 2 },
    period_forced_to_unforced_ratio: 1.6,
    period_forced_errors_induced: 16,
    period_unforced_errors: 10,
    matches_logged_this_period: 10,
  }),
  member({
    player_id: "p1",
    period_record: { wins: 5, losses: 5 },
    period_forced_to_unforced_ratio: 0.7,
    period_forced_errors_induced: 7,
    period_unforced_errors: 10,
    matches_logged_this_period: 10,
  }),
  member({
    player_id: "p2",
    period_record: { wins: 1, losses: 8 },
    period_forced_to_unforced_ratio: 0.9,
    period_forced_errors_induced: 9,
    period_unforced_errors: 10,
    matches_logged_this_period: 9,
  }),
  member({
    player_id: "p3",
    period_record: { wins: 1, losses: 0 },
    period_forced_to_unforced_ratio: 0.5,
    period_forced_errors_induced: 2,
    period_unforced_errors: 2,
    matches_logged_this_period: 1,
  }),
];

const trend: SquadTrendPoint[] = [
  { week: "Aug 3", value: 55 },
  { week: "Aug 10", value: 60 },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players") return Promise.resolve(Response.json(players));
      if (pathname === "/api/squad/analytics/members")
        return Promise.resolve(Response.json(squadStats));
      if (pathname === "/api/squad/analytics/trend") return Promise.resolve(Response.json(trend));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: StatsPage,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: () => <h1>Players</h1>,
  });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches",
    component: () => <h1>Matches</h1>,
  });
  const routeTree = rootRoute.addChildren([statsRoute, homeRoute, playersRoute, matchesRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/stats"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Squad stats" });
  await screen.findByText("Leaderboard");
}

function leaderboardChips() {
  return screen.getByRole("group", { name: "Leaderboard metric" });
}

function trendChips() {
  return screen.getByRole("group", { name: "Trend metric" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the squad headline with an icon per stat, split forced/unforced counts, and the period's match count", async () => {
  stubFetch();
  await renderPage();

  expect(screen.getAllByText("First serves landing in play").length).toBeGreaterThan(0);
  // Sum of the four members' wins/losses (8+5+1+1 / 2+5+8+0) — both happen to
  // be 15, shown as two separate icon-marked numbers rather than "15W – 15L".
  const winRecordBlock = screen.getByText("Win record").parentElement!;
  expect(within(winRecordBlock).getAllByText("15")).toHaveLength(2);
  // Sum of forced (16+7+9+2=34) and unforced (10+10+10+2=32) counts, not a ratio.
  expect(screen.getByText("34 | 32")).toBeInTheDocument();
  // 10 + 10 + 9 + 1.
  expect(await screen.findByText("Squad · 30 matches this period")).toBeInTheDocument();
});

test("leaderboard ranks every player, no minimum-matches threshold or dimming", async () => {
  stubFetch();
  await renderPage();

  const rows = await screen.findAllByText(/Chen|Singh|Rivera|Ross/);
  // Default metric is win %: Ross (1-0, 100%) now outranks everyone, since
  // there's no threshold excluding a 1-match player any more.
  expect(rows.map((row) => row.textContent)).toEqual([
    "Rookie Ross",
    "Alex Chen",
    "Priya Singh",
    "Sam Rivera",
  ]);
  expect(screen.queryByText(/3\+ matches logged/)).not.toBeInTheDocument();
  expect(screen.queryByText(/matches$/)).not.toBeInTheDocument();
});

test("switching the leaderboard metric chip reorders the ranked rows", async () => {
  stubFetch();
  const user = userEvent.setup({ delay: null });
  await renderPage();
  await screen.findAllByText(/Chen|Singh|Rivera|Ross/);

  await user.click(within(leaderboardChips()).getByRole("button", { name: "Forced : Unforced" }));

  const rows = screen.getAllByText(/Chen|Singh|Rivera|Ross/);
  expect(rows.map((row) => row.textContent)).toEqual([
    "Alex Chen",
    "Sam Rivera",
    "Priya Singh",
    "Rookie Ross",
  ]);
  // The row shows the split counts, not the ratio, for this metric.
  expect(screen.getByText("16 | 10")).toBeInTheDocument();
});

test("search filters the leaderboard", async () => {
  stubFetch();
  const user = userEvent.setup({ delay: null });
  await renderPage();
  await screen.findAllByText(/Chen|Singh|Rivera|Ross/);

  await user.type(screen.getByPlaceholderText("Search players"), "Sam");

  expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
  expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
});

test("the trend card's metric selection is independent of the leaderboard's", async () => {
  stubFetch();
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(within(leaderboardChips()).getByRole("button", { name: "Forced : Unforced" }));

  expect(
    within(trendChips()).getByRole("button", { name: "Win percentage", pressed: true }),
  ).toBeInTheDocument();
  expect(
    within(leaderboardChips()).getByRole("button", {
      name: "Forced : Unforced",
      pressed: true,
    }),
  ).toBeInTheDocument();
});

test("shows the trend caption", async () => {
  stubFetch();
  await renderPage();

  expect(
    await screen.findByText("6 weeks to the last match · pooled across the squad"),
  ).toBeInTheDocument();
});

// A roster with no resulted matches in the window gets every week back as
// null (the API's own honest "can't answer" value) — drawn as-is that would
// be a blank chart with axes and nothing else, reading as broken rather than
// as "not enough data yet" (found live against the demo dataset).
test("shows an empty state instead of a blank chart when every week is null", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players") return Promise.resolve(Response.json(players));
      if (pathname === "/api/squad/analytics/members") {
        return Promise.resolve(Response.json(squadStats));
      }
      if (pathname === "/api/squad/analytics/trend") {
        const empty: SquadTrendPoint[] = [
          { week: "Wk 1", value: null },
          { week: "Wk 2", value: null },
        ];
        return Promise.resolve(Response.json(empty));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );

  await renderPage();

  expect(
    await screen.findByText("Not enough recent matches to show a trend yet."),
  ).toBeInTheDocument();
});

// #225: one shared filter for the whole roster, deliberately not offering
// Carpet — effectively extinct in tennis, unlike the player page's own
// data-driven surface chips.
test("the surface filter offers Hard/Clay/Grass but never Carpet", async () => {
  stubFetch();
  await renderPage();

  const group = screen.getByRole("group", { name: "Surface" });
  expect(within(group).getByRole("button", { name: "All" })).toBeInTheDocument();
  expect(within(group).getByRole("button", { name: "Hard" })).toBeInTheDocument();
  expect(within(group).getByRole("button", { name: "Clay" })).toBeInTheDocument();
  expect(within(group).getByRole("button", { name: "Grass" })).toBeInTheDocument();
  expect(within(group).queryByRole("button", { name: "Carpet" })).not.toBeInTheDocument();
});

test("picking a surface re-fetches both the members and the trend with it applied", async () => {
  const user = userEvent.setup({ delay: null });
  const requestedUrls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      requestedUrls.push(input.url);
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players") return Promise.resolve(Response.json(players));
      if (pathname === "/api/squad/analytics/members") {
        return Promise.resolve(Response.json(squadStats));
      }
      if (pathname === "/api/squad/analytics/trend") return Promise.resolve(Response.json(trend));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
  await renderPage();
  requestedUrls.length = 0;

  await user.click(screen.getByRole("button", { name: "Clay" }));

  await vi.waitFor(() => {
    expect(
      requestedUrls.some(
        (url) => url.includes("/squad/analytics/members") && url.includes("surface=clay"),
      ),
    ).toBe(true);
  });
  expect(
    requestedUrls.some(
      (url) => url.includes("/squad/analytics/trend") && url.includes("surface=clay"),
    ),
  ).toBe(true);
});

test("the Spread histogram is gone", async () => {
  stubFetch();
  await renderPage();
  await screen.findAllByText(/Chen|Singh|Rivera|Ross/);

  expect(screen.queryByText(/Spread/)).not.toBeInTheDocument();
});

// #274: a failed roster query used to render an indefinite skeleton, with no
// signal the page had actually broken rather than just still loading.
test("shows an alert instead of an indefinite skeleton when the roster fails to load", async () => {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players")
        return Promise.resolve(new Response("nope", { status: 500 }));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: StatsPage,
  });
  const routeTree = rootRoute.addChildren([statsRoute]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={createRouter({
          routeTree,
          history: createMemoryHistory({ initialEntries: ["/stats"] }),
        })}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load squad stats.");
});

// The trend card's own query can fail independently of the roster/leaderboard
// ones above it on the same page.
test("shows an alert on the trend card alone when only the trend query fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players") return Promise.resolve(Response.json(players));
      if (pathname === "/api/squad/analytics/members")
        return Promise.resolve(Response.json(squadStats));
      if (pathname === "/api/squad/analytics/trend")
        return Promise.resolve(new Response("nope", { status: 500 }));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );

  await renderPage();

  expect(await screen.findByText("Could not load the squad trend.")).toBeInTheDocument();
  // The rest of the page still rendered from its own, successful queries.
  expect(screen.getAllByText(/Chen|Singh|Rivera|Ross/).length).toBeGreaterThan(0);
});
