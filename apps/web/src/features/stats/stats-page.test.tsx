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
    last5: ["win", "win", "loss", "win", "win"],
    forced_to_unforced_ratio: 1,
    first_serve_in_percent: 60,
    period_record: { wins: 0, losses: 0 },
    current_streak: null,
    days_since_last_match: 1,
    tracked_stats: [],
    ...overrides,
  };
}

// index 0 (8–2, ratio 1.6) beats index 2 (1–8, ratio 0.9) on Record, but
// index 2 beats index 1 (5–5, ratio 0.7) on Forced:Unforced — a real
// reordering between metrics. Index 3 (1 match) sits below the ranking
// threshold.
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
    forced_to_unforced_ratio: 1.6,
    matches_logged_this_period: 10,
  }),
  member({
    player_id: "p1",
    period_record: { wins: 5, losses: 5 },
    forced_to_unforced_ratio: 0.7,
    matches_logged_this_period: 10,
  }),
  member({
    player_id: "p2",
    period_record: { wins: 1, losses: 8 },
    forced_to_unforced_ratio: 0.9,
    matches_logged_this_period: 9,
  }),
  member({
    player_id: "p3",
    period_record: { wins: 1, losses: 0 },
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

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the squad headline with an icon per stat, and the period's match count", async () => {
  stubFetch();
  await renderPage();

  // "Record" also names the leaderboard's default metric selection, so this
  // checks the labels that only appear on the headline card.
  expect(screen.getByText("Forced : Unforced")).toBeInTheDocument();
  expect(screen.getByText("1st serve in %")).toBeInTheDocument();
  // Sum of the four members' wins/losses (8+5+1+1 / 2+5+8+0).
  expect(screen.getByText("15W – 15L")).toBeInTheDocument();
  // 10 + 10 + 9 + 1.
  expect(await screen.findByText("Squad · 30 matches this period")).toBeInTheDocument();
});

test("leaderboard defaults to Record order, sub-threshold player dimmed at the bottom", async () => {
  stubFetch();
  await renderPage();

  const rows = await screen.findAllByText(/Chen|Singh|Rivera|Ross/);
  expect(rows.map((row) => row.textContent)).toEqual([
    "Alex Chen",
    "Priya Singh",
    "Sam Rivera",
    "Rookie Ross",
  ]);
  expect(screen.getByText("1 match")).toBeInTheDocument();
  expect(screen.getByText(/3\+ matches logged/)).toBeInTheDocument();
});

test("switching the leaderboard metric reorders the ranked rows", async () => {
  stubFetch();
  const user = userEvent.setup({ delay: null });
  await renderPage();
  await screen.findAllByText(/Chen|Singh|Rivera|Ross/);

  await user.click(screen.getByRole("combobox", { name: "Leaderboard metric" }));
  await user.click(await screen.findByRole("option", { name: "Forced : Unforced" }));

  const rows = screen.getAllByText(/Chen|Singh|Rivera|Ross/);
  expect(rows.map((row) => row.textContent)).toEqual([
    "Alex Chen",
    "Sam Rivera",
    "Priya Singh",
    "Rookie Ross",
  ]);
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

  await user.click(screen.getByRole("combobox", { name: "Leaderboard metric" }));
  await user.click(await screen.findByRole("option", { name: "Forced : Unforced" }));

  expect(
    within(screen.getByRole("combobox", { name: "Trend metric" })).getByText("Record (win %)"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("combobox", { name: "Leaderboard metric" })).getByText(
      "Forced : Unforced",
    ),
  ).toBeInTheDocument();
});

test("shows the trend caption", async () => {
  stubFetch();
  await renderPage();

  expect(await screen.findByText("last 6 weeks · pooled across the squad")).toBeInTheDocument();
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
