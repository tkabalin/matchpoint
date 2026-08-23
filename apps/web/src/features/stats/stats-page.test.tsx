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

// Roster order maps to `SQUAD_STATS_TEMPLATES`' round-robin in fixtures.ts:
// index 0 (8–2, ratio 1.6) beats index 2 (1–8, ratio 0.9) on Record, but index
// 2 beats index 1 (5–5, ratio 0.7) on Forced:Unforced — a real reordering
// between metrics. Index 3 (1 match) sits below the ranking threshold.
const players: PlayerRead[] = [
  player("p0", "Alex", "Chen"),
  player("p1", "Priya", "Singh"),
  player("p2", "Sam", "Rivera"),
  player("p3", "Rookie", "Ross"),
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players") return Promise.resolve(Response.json(players));
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

test("shows the squad headline with an icon per stat", async () => {
  stubFetch();
  await renderPage();

  // "Record" also names the leaderboard's default metric selection, so this
  // checks the labels that only appear on the headline card.
  expect(screen.getByText("Forced : Unforced")).toBeInTheDocument();
  expect(screen.getByText("1st serve %")).toBeInTheDocument();
  // Sum of the four templates' wins/losses (8+5+1+1 / 2+5+8+0).
  expect(screen.getByText("15–15")).toBeInTheDocument();
});

test("leaderboard defaults to Record order, sub-threshold player dimmed at the bottom", async () => {
  stubFetch();
  await renderPage();

  const rows = screen.getAllByText(/Chen|Singh|Rivera|Ross/);
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
  const user = userEvent.setup();
  await renderPage();

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
  const user = userEvent.setup();
  await renderPage();

  await user.type(screen.getByPlaceholderText("Search players"), "Sam");

  expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
  expect(screen.queryByText("Alex Chen")).not.toBeInTheDocument();
});

test("the trend card's metric selection is independent of the leaderboard's", async () => {
  stubFetch();
  const user = userEvent.setup();
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

  expect(await screen.findByText("last 6 weeks · squad average")).toBeInTheDocument();
});
