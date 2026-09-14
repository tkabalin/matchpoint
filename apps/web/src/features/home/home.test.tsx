import type { CoachRead, PlayerRead, SquadMemberStats } from "@matchpoint/api-client";
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
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const players: PlayerRead[] = [
  {
    id: "3f1c2b4e-0000-4000-8000-000000000001",
    first_name: "Amahle",
    last_name: "Nkosi",
    username: "nksama001",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    has_transfer_code: false,
    photo_url: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
  {
    id: "3f1c2b4e-0000-4000-8000-000000000002",
    first_name: "Sipho",
    last_name: "Dlamini",
    username: "dlmsip001",
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: coach.id,
    has_transfer_code: false,
    photo_url: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  },
];

// A third roster slot, used by the two attention-card tests below.
const flaggedPlayer: PlayerRead = {
  ...players[1]!,
  id: "3f1c2b4e-0000-4000-8000-000000000003",
  first_name: "Zanele",
  last_name: "Khumalo",
};

function squadMember(
  overrides: Partial<SquadMemberStats> & { player_id: string },
): SquadMemberStats {
  return {
    matches_logged_this_period: 5,
    last5_results: ["win", "win", "win", "loss", "win"],
    period_forced_to_unforced_ratio: 1.5,
    period_forced_errors_induced: 30,
    period_unforced_errors: 20,
    period_forced_errors_suffered: 20,
    period_points_won: 100,
    period_points_lost: 90,
    period_first_serve_in_percent: 60,
    period_record: { wins: 4, losses: 1 },
    current_streak: { outcome: "win", length: 1 },
    days_since_last_match: 1,
    last5_stats: {
      first_serve_in_percent: 60,
      return_in_percent: 70,
      forced_to_unforced_ratio: 1.5,
      forced_errors_induced: 18,
      unforced_errors: 12,
      forced_errors_suffered: 8,
      points_won: 40,
      points_lost: 35,
    },
    tracked_stats: [],
    ...overrides,
  };
}

// Deliberately no hard flag and no tracked-stat decline on either — an empty
// needs-attention result is the legitimate case these two exist to cover.
const bestFormMember = squadMember({
  player_id: players[0]!.id,
  period_record: { wins: 9, losses: 1 },
  last5_results: ["win", "win", "win", "win", "win"],
});
const worstFormMember = squadMember({
  player_id: players[1]!.id,
  period_record: { wins: 1, losses: 9 },
  last5_results: ["loss", "loss", "loss", "loss", "win"],
});
const flaggedMember = squadMember({
  player_id: flaggedPlayer.id,
  current_streak: { outcome: "loss", length: 4 },
  period_record: { wins: 1, losses: 4 },
});

/** Routes by pathname rather than returning one canned response for every call:
 * Home now fetches /coaches/me, /players, and /squad/analytics/members, which
 * need different shapes. */
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
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
  });
}

function stubUnauthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json([]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([]),
  });
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
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
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
  const newMatchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match",
    component: () => <h1>New Match</h1>,
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
    newMatchRoute,
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
  await screen.findByRole("heading", { name: "My players" });
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

  expect(screen.getByRole("heading", { name: "Home", level: 1 })).toBeInTheDocument();
});

test("greets the coach by name once loaded", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByRole("heading", { name: "Coach Danny", level: 1 })).toBeInTheDocument();
});

test("links to the profile page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Profile" }));

  expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
});

test("links to the settings page", async () => {
  stubUnauthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  await user.click(screen.getByRole("link", { name: "Settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("shows the signed-in coach's name once loaded", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("Coach Danny")).toBeInTheDocument();
});

// The header Profile link starts as a generic icon (no coach known yet) and swaps
// to the coach's own avatar once loaded — bigger and more recognisable than a
// stand-in icon, per Jakob's Law (#179).
test("the profile link shows the coach's initials once loaded", async () => {
  stubAuthenticatedHome();
  await renderHome();

  const profileLink = await screen.findByRole("link", { name: "Profile" });
  expect(within(profileLink).getByText("D")).toBeInTheDocument();
});

test("the profile link falls back to a generic icon before the coach loads", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  const profileLink = screen.getByRole("link", { name: "Profile" });
  expect(within(profileLink).queryByText(/^\w$/)).not.toBeInTheDocument();
});

test("shows no welcome-back line when the coach can't be loaded", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.queryByText("Welcome back")).not.toBeInTheDocument();
});

// The nudge is keyed on a signed-in coach existing, same as the welcome-back line
// above — it has nothing to say to a visitor whose session hasn't resolved yet.
test("shows the install nudge for a signed-in coach", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("Install MatchPoint")).toBeInTheDocument();
});

test("shows no install nudge before the coach is known", async () => {
  stubUnauthenticatedHome();
  await renderHome();

  expect(screen.queryByText("Install MatchPoint")).not.toBeInTheDocument();
});

// Same reasoning as the install nudge above: keyed on a signed-in coach with no
// photo yet — sign-up can't offer a photo step itself (#179), so this is where a
// coach who skipped one first gets the chance.
test("shows the add-photo nudge for a signed-in coach with no photo", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(await screen.findByText("Add a profile photo")).toBeInTheDocument();
});

test("shows no add-photo nudge once the coach has a photo", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json({ ...coach, photo_url: "/api/media/abc.webp" }),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
  });
  await renderHome();

  expect(screen.queryByText("Add a profile photo")).not.toBeInTheDocument();
});

test("shows no results list until the user types", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("filters players as the user types", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  await user.type(screen.getByLabelText("Search players"), "sipho");

  const results = within(await screen.findByRole("list", { name: "Search results" }));
  expect(results.getByText("Sipho Dlamini")).toBeInTheDocument();
  expect(results.queryByText("Amahle Nkosi")).not.toBeInTheDocument();
});

test("shows an empty state when no player matches", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
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

// The roster bubble is a direct link now, not a picker sheet — #262 retired the
// intermediate step for every player row on the app, this one included. Scoped
// to "My players" specifically: the squad snapshot's own Best/Worst form rows
// are also links to the same profile and can name the same player.
test("a player bubble links straight to their profile", async () => {
  stubAuthenticatedHome();
  await renderHome();
  const heading = await screen.findByRole("heading", { name: "My players" });
  const section = within(heading.closest("section")!);
  await section.findByText("AN");

  expect(section.getByRole("link", { name: /Amahle/ })).toHaveAttribute(
    "href",
    `/players/${players[0]!.id}`,
  );
});

test("tapping a player bubble opens the profile and records them as last-viewed", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();
  const heading = await screen.findByRole("heading", { name: "My players" });
  const section = within(heading.closest("section")!);
  await section.findByText("AN");

  await user.click(section.getByRole("link", { name: /Amahle/ }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
  expect(getLastViewedPlayerId()).toBe(players[0]!.id);
});

test("'See all' links to the players roster", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  await user.click(screen.getByRole("link", { name: "See all" }));

  expect(await screen.findByRole("heading", { name: "Players" })).toBeInTheDocument();
});

// Was a Link to the roster that did nothing but navigate — the coach then still had
// to find and press the roster's own Add action (#177 postscript).
test("'Add' opens the add-player sheet directly", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  await user.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByRole("heading", { name: "Add a player" })).toBeInTheDocument();
});

test("shows no continue-with box when nothing has been viewed yet", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("heading", { name: "Continue with" })).not.toBeInTheDocument();
});

test("shows the last-viewed player once one has been viewed", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  await renderHome();

  const heading = await screen.findByRole("heading", { name: "Continue with" });
  const section = within(heading.closest("section")!);
  expect(section.getByText("Amahle Nkosi")).toBeInTheDocument();
  expect(section.getByText("AN")).toBeInTheDocument();
  expect(await section.findByText(/Last viewed just now · vs T\. Naidoo/)).toBeInTheDocument();
  expect(section.getByRole("link", { name: "View full stats" })).toBeInTheDocument();
});

test("'View full stats' opens the last-viewed player's profile", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  const user = userEvent.setup({ delay: null });
  await renderHome();
  await screen.findByRole("heading", { name: "Continue with" });

  await user.click(screen.getByRole("link", { name: "View full stats" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

// The row itself now goes straight to the same place "View full stats" does —
// #262 retired the picker sheet this used to raise.
test("tapping the continue-with player row opens their profile directly", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  const user = userEvent.setup({ delay: null });
  await renderHome();
  const heading = await screen.findByRole("heading", { name: "Continue with" });
  const section = within(heading.closest("section")!);

  await user.click(section.getByRole("link", { name: /Amahle Nkosi/ }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("shows the squad's player count", async () => {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
  });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  expect(snapshot.getByText("2")).toBeInTheDocument();
  expect(snapshot.getByText("players")).toBeInTheDocument();
});

// bestFormMember/worstFormMember trip neither tier — nothing in either flags,
// which is itself the point: an empty result is what "nobody needs attention
// this week" should look like, not a fallback to whichever player is worst.
test("ranks best and worst form, and shows nothing at all for a legitimate empty needs-attention state", async () => {
  stubAuthenticatedHome();
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  expect(snapshot.getByText("Best form")).toBeInTheDocument();
  expect(snapshot.getByText("Amahle Nkosi")).toBeInTheDocument();
  expect(snapshot.getByText("Worst form")).toBeInTheDocument();
  expect(snapshot.getByText("Sipho Dlamini")).toBeInTheDocument();
  // No placeholder text, no card — matches how AddPhotoNudge/InstallAppNudge
  // render nothing when there's nothing to say (#205).
  expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
});

test("shows a dismissible card when a player is flagged", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([...players, flaggedPlayer]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () =>
      Response.json([bestFormMember, worstFormMember, flaggedMember]),
  });
  await renderHome();

  expect(await screen.findByText("Zanele Khumalo")).toBeInTheDocument();
  expect(screen.getByText("4-match losing streak")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Dismiss the attention flag for Zanele Khumalo" }),
  ).toBeInTheDocument();
});

test("dismissing the attention card hides it", async () => {
  localStorage.removeItem("matchpoint:attention-dismissed");
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([...players, flaggedPlayer]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () =>
      Response.json([bestFormMember, worstFormMember, flaggedMember]),
  });
  const user = userEvent.setup({ delay: null });
  await renderHome();
  await screen.findByText("Zanele Khumalo");

  await user.click(
    screen.getByRole("button", { name: "Dismiss the attention flag for Zanele Khumalo" }),
  );

  expect(screen.queryByText("Zanele Khumalo")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Dismiss the attention flag for Zanele Khumalo" }),
  ).not.toBeInTheDocument();
});

test("best/worst form show last-5 and forced:unforced as icon+number pairs, like Continue with", async () => {
  stubAuthenticatedHome();
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  const bestRow = (await snapshot.findByText("Amahle Nkosi")).closest("a")!;
  expect(within(bestRow).getByText("Last 5")).toBeInTheDocument();
  expect(within(bestRow).getByText("Forced : Unforced")).toBeInTheDocument();
});

test("tapping a squad-snapshot row goes straight to that player's stats page", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  await user.click(await snapshot.findByRole("link", { name: /Amahle Nkosi/ }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

// Same floating action as the matches page (primary-match-action.tsx's own
// "offers starting a match" test) — home gets the identical control, not a
// second implementation of it.
test("offers starting a match from the home screen too", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  const startMatch = screen.getByRole("link", { name: "Start a match" });
  expect(startMatch).toHaveAttribute("href", "/new-match");

  await user.click(startMatch);

  expect(await screen.findByRole("heading", { name: "New Match" })).toBeInTheDocument();
});

test("renders the bottom nav with Home active", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Squad stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
});
