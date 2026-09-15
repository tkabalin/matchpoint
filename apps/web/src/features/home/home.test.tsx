import type {
  CoachRead,
  PlayerRead,
  RallyStats,
  ServeStats,
  SquadMemberStats,
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

// Distinct on purpose across every ranked axis, so each of the squad
// snapshot's rows resolves to an unambiguous winner rather than a tie (a tie
// is real, tested behaviour too, but only the dedicated tie test below needs
// it). `last5_results` still varies too, since it drives each row's own
// recent-form dots even though the ranking itself now reads `period_*`.
const bestFormMember = squadMember({
  player_id: players[0]!.id,
  last5_results: ["win", "win", "win", "win", "win"],
  period_record: { wins: 5, losses: 0 },
  period_first_serve_in_percent: 80,
  period_forced_errors_suffered: 18,
  period_unforced_errors: 2,
});
const worstFormMember = squadMember({
  player_id: players[1]!.id,
  last5_results: ["loss", "loss", "loss", "loss", "win"],
  // Distinct from flaggedMember's own period_record below (also a losing
  // record) so the two don't tie for "Worst win %" in tests that stub both.
  period_record: { wins: 0, losses: 4 },
  period_first_serve_in_percent: 40,
  period_forced_errors_suffered: 2,
  period_unforced_errors: 18,
});
const flaggedMember = squadMember({
  player_id: flaggedPlayer.id,
  current_streak: { outcome: "loss", length: 4 },
  period_record: { wins: 1, losses: 4 },
});

const EMPTY_STYLE_DETAIL = {
  wing: { forehand: 0, backhand: 0 },
  shot_type: [],
  court_zones: [],
  unusual_reasons: null,
};

// Aggression/passivity read from RallyStats, not SquadMemberStats — a
// forced-heavy `styles.you` reads as aggressive, an unforced-heavy one as
// passive (aggressionScore's own reasoning in squad-stats.ts).
const aggressiveRallyStats: RallyStats = {
  ...emptyRallyStats,
  styles: {
    you: [
      { kind: "forced", label: "Forced (your pressure)", count: 18, detail: EMPTY_STYLE_DETAIL },
      { kind: "unforced", label: "Unforced", count: 2, detail: EMPTY_STYLE_DETAIL },
    ],
    opponents: [],
  },
};
const passiveRallyStats: RallyStats = {
  ...emptyRallyStats,
  styles: {
    you: [
      { kind: "forced", label: "Forced (your pressure)", count: 2, detail: EMPTY_STYLE_DETAIL },
      { kind: "unforced", label: "Unforced", count: 18, detail: EMPTY_STYLE_DETAIL },
    ],
    opponents: [],
  },
};

/** Routes by pathname, matching on a substring rather than the exact string —
 *  a per-player analytics call (`/analytics/rally`) varies by player id, and
 *  a squad-wide fan-out (the tendency rows' roster-wide rally fetch, plus
 *  the Continue-with card's own PlayerCard) hits it once per roster player.
 *  Same convention as player-list.test.tsx's stubFetchByPath. */
function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      // Longest matching path wins, not first-in-object-order: "/api/players" is
      // itself a substring of "/api/players/{id}" and "/api/players/{id}/analytics/rally",
      // so an insertion-order `.find` let the roster-list route swallow requests
      // meant for a single player or their rally stats, whichever route happened
      // to be declared first in a given test's call.
      const handler = Object.entries(routes)
        .filter(([path]) => pathname.includes(path))
        .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

// Every route below `stubFetch` needs an exact-path entry (for the roster,
// squad stats, etc.) plus these two fallbacks: Home fans out a rally-stats
// request per roster player for the aggression/passivity rows, and the
// Continue-with card (a real PlayerCard) fetches both rally and serve stats
// for whichever one player it's showing.
const FALLBACK_ROUTES = {
  "/analytics/rally": () => Response.json(emptyRallyStats),
  "/analytics/serve": () => Response.json(emptyServeStats),
};

function stubAuthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
    ...FALLBACK_ROUTES,
  });
}

function stubUnauthenticatedHome() {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json([]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([]),
    ...FALLBACK_ROUTES,
  });
}

function stubAuthenticatedHomeWithLastViewedPlayer() {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    [`/api/players/${players[0]!.id}`]: () => Response.json(players[0]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
    ...FALLBACK_ROUTES,
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
    ...FALLBACK_ROUTES,
  });
  await renderHome();

  expect(screen.queryByText("Add a profile photo")).not.toBeInTheDocument();
});

test("shows no results list until the user types", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
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

  const heading = await screen.findByRole("heading", { name: "My players" });
  const section = within(heading.closest("section")!);
  expect(await section.findByText("AN")).toBeInTheDocument();
  expect(section.getByText("SD")).toBeInTheDocument();
  expect(section.getByText("Amahle")).toBeInTheDocument();
  expect(section.getByText("Sipho")).toBeInTheDocument();
});

// The roster bubble is a direct link now, not a picker sheet — #262 retired the
// intermediate step for every player row on the app, this one included. Scoped
// to "My players" specifically: the squad snapshot's own tendency rows are also
// links to the same profile and can name the same player.
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

  await user.click(screen.getByRole("button", { name: "Add a player" }));

  expect(await screen.findByRole("heading", { name: "Add a player" })).toBeInTheDocument();
});

test("shows no continue-with box when nothing has been viewed yet", async () => {
  stubAuthenticatedHome();
  await renderHome();

  expect(screen.queryByRole("heading", { name: "Continue with" })).not.toBeInTheDocument();
});

// Continue-with is now the real, shared PlayerCard (#225 item 5) — its own
// behaviour (View stats/Start match, the header being inert, its stat rows) is
// covered where PlayerCard is tested (player-list.test.tsx). This only checks
// that Home wires the right player into the right slot.
test("shows the last-viewed player once one has been viewed", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  await renderHome();

  const heading = await screen.findByRole("heading", { name: "Continue with" });
  const section = within(heading.closest("section")!);
  expect(section.getByText("Amahle Nkosi")).toBeInTheDocument();
  expect(section.getByRole("link", { name: /View stats/ })).toBeInTheDocument();
  expect(section.getByRole("link", { name: /Start match/ })).toBeInTheDocument();
});

test("'View stats' opens the last-viewed player's profile", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  const user = userEvent.setup({ delay: null });
  await renderHome();
  const heading = await screen.findByRole("heading", { name: "Continue with" });
  const section = within(heading.closest("section")!);

  await user.click(section.getByRole("link", { name: /View stats/ }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("shows the squad's player count, with a matching row of tally icons", async () => {
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
    ...FALLBACK_ROUTES,
  });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  expect(snapshot.getByText("2")).toBeInTheDocument();
  expect(snapshot.getByText("players")).toBeInTheDocument();
  expect(snapshot.getByTestId("player-tally").querySelectorAll("svg")).toHaveLength(2);
});

test("caps the player tally at 8 icons and shows the overflow count", async () => {
  const bigRoster: PlayerRead[] = Array.from({ length: 9 }, (_, index) => ({
    ...players[0]!,
    id: `3f1c2b4e-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
    first_name: `Player${index}`,
  }));
  stubFetch({
    "/api/coaches/me": () => new Response(null, { status: 401 }),
    "/api/players": () => Response.json(bigRoster),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([]),
    ...FALLBACK_ROUTES,
  });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  expect(snapshot.getByText("9")).toBeInTheDocument();
  expect(snapshot.getByTestId("player-tally").querySelectorAll("svg")).toHaveLength(8);
  expect(snapshot.getByText("+1")).toBeInTheDocument();
});

// bestFormMember/worstFormMember are built distinct on every period and
// aggression axis above, so every row resolves to an unambiguous winner —
// rows are located by their own scope-labelled caption, not by player name,
// since one player can (and here, always does) win more than one row.
test("shows the seven tendency rows with their scope-labelled captions and headline players", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([bestFormMember, worstFormMember]),
    [`/api/players/${players[0]!.id}/analytics/rally`]: () => Response.json(aggressiveRallyStats),
    [`/api/players/${players[1]!.id}/analytics/rally`]: () => Response.json(passiveRallyStats),
    ...FALLBACK_ROUTES,
  });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));

  const row = async (label: string) => within(await snapshot.findByTestId(label));

  expect((await row("Best win %")).getByText("Amahle Nkosi")).toBeInTheDocument();
  expect((await row("Best win %")).getByText("100%")).toBeInTheDocument();
  expect((await row("Worst win %")).getByText("Sipho Dlamini")).toBeInTheDocument();
  expect((await row("Steadiest")).getByText("Amahle Nkosi")).toBeInTheDocument();
  expect((await row("Most mistakes")).getByText("Sipho Dlamini")).toBeInTheDocument();
  expect((await row("Most aggressive")).getByText("Amahle Nkosi")).toBeInTheDocument();
  expect((await row("Most passive")).getByText("Sipho Dlamini")).toBeInTheDocument();
  expect((await row("Best 1st serve %")).getByText("Amahle Nkosi")).toBeInTheDocument();
});

// Every stat here comes from the same default squadMember() fixture — a
// genuine tie, which pickBestWorst resolves to showing only the best side,
// per squad-stats.ts's own reasoning (a single eligible value isn't a real
// spread to also call a "worst").
test("a tied metric shows only the best side, not a duplicated worst", async () => {
  const tiedA = squadMember({ player_id: players[0]!.id });
  const tiedB = squadMember({ player_id: players[1]!.id });
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json(players),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () => Response.json([tiedA, tiedB]),
    ...FALLBACK_ROUTES,
  });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  const mistakesRow = within(await snapshot.findByTestId("Most mistakes"));
  expect(mistakesRow.getByText("Not enough matches logged yet.")).toBeInTheDocument();
});

test("ranked rows go straight to that row's own player's stats page", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  const row = within(await snapshot.findByTestId("Best win %"));

  await user.click(row.getByRole("link"));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("tapping a row's info icon explains what that stat measures", async () => {
  stubAuthenticatedHome();
  const user = userEvent.setup({ delay: null });
  await renderHome();

  const snapshot = within(await screen.findByRole("region", { name: "Squad snapshot" }));
  const row = within(await snapshot.findByTestId("Steadiest"));

  await user.click(row.getByRole("button", { name: "Explain Steadiest" }));

  expect(
    await screen.findByText(
      "Share of a player's own errors caused by the opponent, not themselves. Higher means steadier.",
    ),
  ).toBeInTheDocument();
});

test("shows a dismissible card when a player is flagged", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    "/api/players": () => Response.json([...players, flaggedPlayer]),
    "/api/matches": () => Response.json([]),
    "/api/squad/analytics/members": () =>
      Response.json([bestFormMember, worstFormMember, flaggedMember]),
    ...FALLBACK_ROUTES,
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
    ...FALLBACK_ROUTES,
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

test("the squad snapshot and continue-with headings are large and bold", async () => {
  setLastViewedPlayerId(players[0]!.id);
  stubAuthenticatedHomeWithLastViewedPlayer();
  await renderHome();

  expect(await screen.findByRole("heading", { name: "Squad snapshot" })).toHaveClass(
    "text-xl",
    "font-bold",
  );
  expect(screen.getByRole("heading", { name: "Continue with" })).toHaveClass(
    "text-xl",
    "font-bold",
  );
  expect(screen.getByRole("heading", { name: "My players" })).toHaveClass("text-xl", "font-bold");
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
