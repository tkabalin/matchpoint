import type { CoachRead, PlayerRead } from "@matchpoint/api-client";
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

import { getLastViewedPlayerId, setLastViewedPlayerId } from "@/lib/last-viewed-player";

import { Home } from "./home";

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "coach@example.com",
  display_name: "Danny",
  default_surface: null,
  default_scoring_system: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const players: PlayerRead[] = [
  {
    id: "3f1c2b4e-0000-4000-8000-000000000001",
    first_name: "Amahle",
    last_name: "Nkosi",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    archived_at: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
  {
    id: "3f1c2b4e-0000-4000-8000-000000000002",
    first_name: "Sipho",
    last_name: "Dlamini",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    archived_at: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
];

/** Routes by pathname rather than returning one canned response for every call:
 * Home now fetches both /coaches/me and /players, which need different shapes. */
function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[pathname];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

function stubAuthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
  });
}

function stubUnauthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json([]),
    "/api/matches": () => Response.json([]),
  });
}

function daysAgoDateString(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const lastViewedMatches = [
  {
    id: "3f1c2b4e-0000-4000-8000-00000000ma01",
    player_id: players[0]!.id,
    opponent_name: "T. Naidoo",
    played_on: "2026-08-10",
    surface: "hard" as const,
    event: null,
    scoring_system: "traditional" as const,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
];

function stubAuthenticatedHomeWithLastViewedPlayer() {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    [`/api/players/${players[0]!.id}`]: () => Response.json(players[0]),
    "/api/matches": () => Response.json(lastViewedMatches),
  });
}

/** Renders Home inside a real (in-memory) router — its Profile/Settings links need
 * router context, same reasoning as sign-in.test.tsx's renderSignIn(). */
async function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: Home,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    component: () => <h1>Profile</h1>,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
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
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: () => <h1>Stats</h1>,
  });
  const playerProfileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const routeTree = rootRoute.addChildren([
    homeRoute,
    profileRoute,
    settingsRoute,
    playersRoute,
    matchesRoute,
    statsRoute,
    playerProfileRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/home"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Welcome to Home" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  localStorage.clear();
});

test("renders the welcome heading", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.getByRole("heading", { name: "Welcome to Home" })).toBeInTheDocument();
});

test("links to the profile page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Profile" }));

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

test("links to the settings page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("shows the signed-in coach's name once loaded", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("Coach Danny")).toBeInTheDocument();
});

test("shows no welcome-back line when the coach can't be loaded", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
});

test("shows no results list until the user types", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("filters players as the user types", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.type(screen.getByLabelText("Search players"), "sipho");

  expect(await screen.findByText("Sipho Dlamini")).toBeInTheDocument();
  expect(screen.queryByText("Amahle Nkosi")).not.toBeInTheDocument();
});

test("shows an empty state when no player matches", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.type(screen.getByLabelText("Search players"), "nobody");

  expect(await screen.findByText("No players found.")).toBeInTheDocument();
});

test("renders a bubble with initials for each player", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("AN")).toBeInTheDocument();
  expect(screen.getByText("SD")).toBeInTheDocument();
  expect(screen.getByText("Amahle")).toBeInTheDocument();
  expect(screen.getByText("Sipho")).toBeInTheDocument();
});

test("clicking a player bubble opens their profile and records them as last-viewed", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();
  await screen.findByText("AN");

  await user.click(screen.getByRole("link", { name: "AN Amahle" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
  expect(getLastViewedPlayerId()).toBe(players[0]!.id);
});

test("'See all' links to the players roster", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "See all" }));

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("'Add' links to the players roster for now", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup();
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Add" }));

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

test("shows no last-viewed-player box when nothing has been viewed yet", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("heading", { name: "Last viewed player" })).not.toBeInTheDocument();
});

test("shows the last-viewed player once one has been viewed", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  await renderHome();

  const heading = await screen.findByRole("heading", { name: "Last viewed player" });
  const section = within(heading.closest("div")!);
  expect(section.getByText("Amahle Nkosi")).toBeInTheDocument();
  expect(section.getByText("AN")).toBeInTheDocument();
  expect(section.getByText("Matches: 1")).toBeInTheDocument();
  expect(section.getByRole("link", { name: "View full profile" })).toBeInTheDocument();
});

test("'View full profile' opens the last-viewed player's profile", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  const user = userEvent.setup();
  await renderHome();
  await screen.findByRole("heading", { name: "Last viewed player" });

  await user.click(screen.getByRole("link", { name: "View full profile" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("shows the squad's player count and matches played in the last 7 days", async () => {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json(players),
    "/api/matches": () =>
      Response.json([
        { ...lastViewedMatches[0], id: "match-recent", played_on: daysAgoDateString(2) },
        { ...lastViewedMatches[0], id: "match-old", played_on: daysAgoDateString(14) },
      ]),
  });
  await renderHome();

  const heading = await screen.findByRole("heading", { name: "Squad snapshot" });
  const section = within(heading.closest("div")!);
  expect(section.getByText("Players: 2")).toBeInTheDocument();
  expect(section.getByText("Matches this week: 1")).toBeInTheDocument();
});

test("counts a match played today from a timezone ahead of UTC", async () => {
  // 01:30 SAST is still the previous day in UTC, so reading `played_on` as UTC midnight
  // would date today's match in the future and leave it out of the count. Only Date is
  // faked: faking setTimeout as well would stall the query client and the DOM polling.
  vi.stubEnv("TZ", "Africa/Johannesburg");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-15T23:30:00Z"));
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json(players),
    "/api/matches": () =>
      Response.json([{ ...lastViewedMatches[0], id: "match-today", played_on: "2026-08-16" }]),
  });
  await renderHome();

  const heading = await screen.findByRole("heading", { name: "Squad snapshot" });
  expect(within(heading.closest("div")!).getByText("Matches this week: 1")).toBeInTheDocument();
});

test("shows an empty needs-attention state until trend flagging exists", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
  expect(screen.getByText("No flagged trends yet.")).toBeInTheDocument();
});

test("renders the bottom nav with Home active", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
});
