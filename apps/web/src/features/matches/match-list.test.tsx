import type { MatchRead, PlayerRead, PointRead } from "@matchpoint/api-client";
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

import { MatchList } from "./match-list";

// Annotated rather than inferred so tsc holds the fixture to the generated contract —
// same reasoning as player-list.test.tsx's player fixture.
const match: MatchRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  player_id: "3f1c2b4e-0000-4000-8000-000000000001",
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: null,
  result_reason: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const player: PlayerRead = {
  id: match.player_id,
  coach_id: "3f1c2b4e-0000-4000-8000-000000000009",
  first_name: "Nomsa",
  last_name: "Dube",
  username: "nomsa-dube",
  photo_url: null,
  notes: null,
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  has_transfer_code: false,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
};

// Every field the type requires, defaulted to "didn't happen" — a test builds
// only the fields its own assertion cares about on top of this.
function point(overrides: Partial<PointRead> & Pick<PointRead, "game_number" | "won">): PointRead {
  return {
    id: `point-${overrides.game_number}-${Math.random()}`,
    match_id: match.id,
    set_number: 1,
    sequence: 0,
    server: "tracked",
    in_tiebreak: false,
    is_break_point: false,
    is_game_end: false,
    is_game_point: false,
    is_match_point: false,
    is_set_end: false,
    is_set_point: false,
    ball_depth: null,
    ball_half: null,
    ball_in: null,
    ball_out_mode: null,
    end_reason: null,
    note: null,
    return_outcome: null,
    rally_length_bucket: null,
    court_side: "deuce",
    serve1_fault_mode: null,
    serve1_outcome: null,
    serve2_fault_mode: null,
    serve2_outcome: null,
    shot_type: null,
    unusual_reason: null,
    wing: null,
    ...overrides,
  };
}

/** A love game (4 points), tracked serving and winning — the shortest, most
 * dominant kind of game this component can plot. */
function lovGameWonByTracked(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true, is_game_end: true }),
  ];
}

/** A break: the opponent serves but tracked wins the game anyway. */
function gameBrokenByTracked(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: true, server: "opponent" }),
    point({ game_number: gameNumber, won: true, server: "opponent" }),
    point({ game_number: gameNumber, won: true, server: "opponent", is_game_end: true }),
  ];
}

function gameWonByOpponent(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: false }),
    point({ game_number: gameNumber, won: false }),
    point({ game_number: gameNumber, won: false, is_game_end: true }),
  ];
}

/** Marks a game's final point as also ending the set — a real completion
 * signal, not something derivable from game counts alone. */
function endingSet(games: PointRead[]): PointRead[] {
  const last = games.at(-1)!;
  return [...games.slice(0, -1), { ...last, is_set_end: true }];
}

/** Routes by pathname — same reasoning as matches-page.test.tsx's stubFetch. A
 * match card's own `listPoints` call is per-match-id, so it's matched by
 * pattern rather than the exact-path checks the other two routes use. */
function stubFetch(routes: {
  matches?: () => Response;
  players?: () => Response;
  points?: () => Response;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/matches")
        return Promise.resolve((routes.matches ?? (() => Response.json([])))());
      if (pathname === "/api/players")
        return Promise.resolve((routes.players ?? (() => Response.json([])))());
      if (/^\/api\/matches\/[^/]+\/points$/.test(pathname))
        return Promise.resolve((routes.points ?? (() => Response.json([])))());
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderMatchList({ onEdit = vi.fn(), onDelete = vi.fn() } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches",
    component: () => <MatchList onEdit={onEdit} onDelete={onDelete} />,
  });
  const matchStatsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches/$matchId",
    component: () => <h1>Match Stats</h1>,
  });
  const routeTree = rootRoute.addChildren([matchesRoute, matchStatsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/matches"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { onEdit, onDelete };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the matches the API returns, both names inline at the same size", async () => {
  stubFetch({ matches: () => Response.json([match]), players: () => Response.json([player]) });

  renderMatchList();

  expect(await screen.findByText("Nomsa Dube")).toBeInTheDocument();
  expect(screen.getByText("T. Naidoo")).toBeInTheDocument();
  expect(screen.getByText("vs")).toBeInTheDocument();
  expect(screen.getByText("Aug 10")).toBeInTheDocument();
  expect(screen.getByText("Hard")).toBeInTheDocument();
});

test("falls back to a placeholder for a match whose player can't be resolved", async () => {
  stubFetch({ matches: () => Response.json([match]) });

  renderMatchList();

  expect(await screen.findByText("Unknown player")).toBeInTheDocument();
});

test("falls back to a placeholder for a match with no opponent name", async () => {
  stubFetch({ matches: () => Response.json([{ ...match, opponent_name: null }]) });

  renderMatchList();

  expect(await screen.findByText("Unknown opponent")).toBeInTheDocument();
});

test("crowns the tracked player once they've won the match", async () => {
  stubFetch({
    matches: () => Response.json([{ ...match, result: "win" }]),
    players: () => Response.json([player]),
  });

  renderMatchList();

  expect(await screen.findByRole("img", { name: "Match winner" })).toBeInTheDocument();
});

test("an unfinished match crowns nobody and says so", async () => {
  stubFetch({ matches: () => Response.json([match]), players: () => Response.json([player]) });

  renderMatchList();

  await screen.findByText("Nomsa Dube");
  expect(screen.queryByRole("img", { name: "Match winner" })).not.toBeInTheDocument();
  expect(screen.getByText("Not finished yet — no winner")).toBeInTheDocument();
});

test("derives set scores and a per-set win/loss mark from the raw point log", async () => {
  stubFetch({
    matches: () => Response.json([{ ...match, result: "win" }]),
    players: () => Response.json([player]),
    points: () =>
      Response.json([
        // Set 1: tracked wins 2 games to 1.
        ...lovGameWonByTracked(1),
        ...gameWonByOpponent(2),
        ...endingSet(gameBrokenByTracked(3)),
      ]),
  });

  renderMatchList();

  expect(await screen.findByText("2–1")).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: "Won set 1" })).toBeInTheDocument();
});

// Found live in production data: a match with a definitive result whose own
// last set carried no is_set_end point (a data gap upstream), which
// previously read as "still in progress" — impossible for a match that's
// actually over — and left that set with no winner mark, floating at a
// different height to its neighbours.
test("a finished match's last set still gets a winner mark even without its own is_set_end point", async () => {
  stubFetch({
    matches: () => Response.json([{ ...match, result: "loss" }]),
    players: () => Response.json([player]),
    points: () =>
      Response.json([
        ...endingSet(lovGameWonByTracked(1)),
        // Set 2, the last one: tracked loses both games so far, but no
        // is_set_end point anywhere in it.
        ...gameWonByOpponent(1).map((p) => ({ ...p, set_number: 2 })),
        ...gameWonByOpponent(2).map((p) => ({ ...p, set_number: 2 })),
      ]),
  });

  renderMatchList();

  expect(await screen.findByRole("img", { name: "Lost set 2" })).toBeInTheDocument();
});

test("a game still being played (no game-end point yet) is left off the timeline", async () => {
  stubFetch({
    matches: () => Response.json([match]),
    players: () => Response.json([player]),
    points: () =>
      Response.json([
        ...lovGameWonByTracked(1),
        // Game 2 has points but never reaches is_game_end — still in progress.
        point({ game_number: 2, won: true }),
        point({ game_number: 2, won: false }),
      ]),
  });

  renderMatchList();

  // Only the one completed game counts, so the set is still 1-0 with no
  // winner mark yet rather than reading the in-progress game as a loss.
  expect(await screen.findByText("1–0")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /Won set|Lost set/ })).not.toBeInTheDocument();
});

test("shows an empty state when there are no matches", async () => {
  stubFetch({ matches: () => Response.json([]) });

  renderMatchList();

  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

test("reports a failed load instead of rendering an empty list", async () => {
  stubFetch({ matches: () => new Response("nope", { status: 500 }) });

  renderMatchList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load matches.");
});

test("tapping a match row navigates to its stats page", async () => {
  stubFetch({ matches: () => Response.json([match]), players: () => Response.json([player]) });
  const user = userEvent.setup({ delay: null });
  renderMatchList();
  await screen.findByText("T. Naidoo");

  await user.click(screen.getByRole("link"));

  expect(await screen.findByRole("heading", { name: "Match Stats" })).toBeInTheDocument();
});

test("the edit icon hands the match to the caller instead of navigating", async () => {
  stubFetch({ matches: () => Response.json([match]), players: () => Response.json([player]) });
  const user = userEvent.setup({ delay: null });
  const { onEdit } = renderMatchList();

  await user.click(await screen.findByRole("button", { name: /Edit details for the match/ }));

  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: match.id }));
  expect(screen.queryByRole("heading", { name: "Match Stats" })).not.toBeInTheDocument();
});

test("the delete icon hands the match to the caller instead of navigating", async () => {
  stubFetch({ matches: () => Response.json([match]), players: () => Response.json([player]) });
  const user = userEvent.setup({ delay: null });
  const { onDelete } = renderMatchList();

  await user.click(await screen.findByRole("button", { name: /Delete the match/ }));

  expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: match.id }));
  expect(screen.queryByRole("heading", { name: "Match Stats" })).not.toBeInTheDocument();
});

test("the edit icon is still offered once the match has a result", async () => {
  stubFetch({
    matches: () => Response.json([{ ...match, result: "win" }]),
    players: () => Response.json([player]),
  });
  renderMatchList();
  await screen.findByText("T. Naidoo");

  expect(screen.getByRole("button", { name: /Edit details for the match/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Delete the match/ })).toBeInTheDocument();
});

test("filters by opponent name", async () => {
  const clay: MatchRead = {
    ...match,
    id: "match-clay",
    opponent_name: "Sarah K",
    surface: "clay",
    played_on: "2026-07-01",
    result: "win",
  };
  const grass: MatchRead = {
    ...match,
    id: "match-grass",
    opponent_name: "Priya M",
    surface: "grass",
    played_on: "2026-08-20",
    result: "loss",
  };
  stubFetch({
    matches: () => Response.json([match, clay, grass]),
    players: () => Response.json([player]),
  });
  const user = userEvent.setup({ delay: null });
  renderMatchList();
  await screen.findByText("T. Naidoo");

  await user.click(screen.getByRole("button", { name: /All matches/ }));
  await user.type(screen.getByPlaceholderText("Search opponent"), "Sarah");

  expect(screen.getByText("Sarah K")).toBeInTheDocument();
  expect(screen.queryByText("T. Naidoo")).not.toBeInTheDocument();
  expect(screen.queryByText("Priya M")).not.toBeInTheDocument();
});

// The three fixtures below are shared by the surface, result and date-range tests, which
// differ only in which control they drive.
function threeMatches(): MatchRead[] {
  const clay: MatchRead = {
    ...match,
    id: "match-clay",
    opponent_name: "Sarah K",
    surface: "clay",
    played_on: "2026-07-01",
    result: "win",
  };
  const grass: MatchRead = {
    ...match,
    id: "match-grass",
    opponent_name: "Priya M",
    surface: "grass",
    played_on: "2026-08-20",
    result: "loss",
  };
  // The base match is hard court, 2026-08-10, and still unfinished.
  return [match, clay, grass];
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  stubFetch({
    matches: () => Response.json(threeMatches()),
    players: () => Response.json([player]),
  });
  renderMatchList();
  await screen.findByText("T. Naidoo");
  await user.click(screen.getByRole("button", { name: /All matches/ }));
}

test("filters by surface", async () => {
  const user = userEvent.setup({ delay: null });
  await openFilters(user);

  await user.click(screen.getByRole("combobox", { name: "Surface" }));
  await user.click(await screen.findByRole("option", { name: "Clay" }));

  expect(screen.getByText("Sarah K")).toBeInTheDocument();
  expect(screen.queryByText("T. Naidoo")).not.toBeInTheDocument();
  expect(screen.queryByText("Priya M")).not.toBeInTheDocument();
});

test("filters by result", async () => {
  const user = userEvent.setup({ delay: null });
  await openFilters(user);

  await user.click(screen.getByRole("combobox", { name: "Result" }));
  await user.click(await screen.findByRole("option", { name: "Losses" }));

  expect(screen.getByText("Priya M")).toBeInTheDocument();
  expect(screen.queryByText("Sarah K")).not.toBeInTheDocument();
});

// "Unfinished" is not the absence of a result filter — it selects matches whose result
// is still null, which is a different set from "any result".
test("filters to matches that were never finished", async () => {
  const user = userEvent.setup({ delay: null });
  await openFilters(user);

  await user.click(screen.getByRole("combobox", { name: "Result" }));
  await user.click(await screen.findByRole("option", { name: "Unfinished" }));

  expect(screen.getByText("T. Naidoo")).toBeInTheDocument();
  expect(screen.queryByText("Sarah K")).not.toBeInTheDocument();
  expect(screen.queryByText("Priya M")).not.toBeInTheDocument();
});

test("filters by a date range, inclusive at both ends", async () => {
  const user = userEvent.setup({ delay: null });
  await openFilters(user);

  await user.type(screen.getByLabelText("From"), "2026-08-10");
  await user.type(screen.getByLabelText("To"), "2026-08-20");

  // 2026-07-01 falls outside; both boundary dates are kept.
  expect(screen.getByText("T. Naidoo")).toBeInTheDocument();
  expect(screen.getByText("Priya M")).toBeInTheDocument();
  expect(screen.queryByText("Sarah K")).not.toBeInTheDocument();
});

test("filters by which of the coach's players played the match", async () => {
  const otherPlayer: PlayerRead = {
    ...player,
    id: "match-riaan-player",
    first_name: "Riaan",
    last_name: "Botha",
  };
  const other: MatchRead = {
    ...match,
    id: "match-riaan",
    player_id: otherPlayer.id,
    opponent_name: "Priya M",
  };
  stubFetch({
    matches: () => Response.json([match, other]),
    players: () => Response.json([player, otherPlayer]),
  });
  const user = userEvent.setup({ delay: null });
  renderMatchList();
  await screen.findByText("T. Naidoo");

  await user.click(screen.getByRole("button", { name: /All matches/ }));
  await user.click(screen.getByRole("combobox", { name: "Player" }));
  await user.click(await screen.findByRole("option", { name: "Riaan Botha" }));

  expect(screen.getByText("Priya M")).toBeInTheDocument();
  expect(screen.queryByText("T. Naidoo")).not.toBeInTheDocument();
});

test("clearing filters restores the full list", async () => {
  const clay: MatchRead = { ...match, id: "match-clay", opponent_name: "Sarah K", surface: "clay" };
  stubFetch({
    matches: () => Response.json([match, clay]),
    players: () => Response.json([player]),
  });
  const user = userEvent.setup({ delay: null });
  renderMatchList();
  await screen.findByText("T. Naidoo");

  await user.click(screen.getByRole("button", { name: /All matches/ }));
  await user.type(screen.getByPlaceholderText("Search opponent"), "Sarah");
  expect(screen.queryByText("T. Naidoo")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Clear filters" }));

  expect(screen.getByText("T. Naidoo")).toBeInTheDocument();
  expect(screen.getByText("Sarah K")).toBeInTheDocument();
});
