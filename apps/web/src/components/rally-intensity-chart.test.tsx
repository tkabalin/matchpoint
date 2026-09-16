import type { PointRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { RallyIntensityChart } from "./rally-intensity-chart";

const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000002";

function point(overrides: Partial<PointRead> & Pick<PointRead, "game_number" | "won">): PointRead {
  return {
    id: `point-${overrides.game_number}-${Math.random()}`,
    match_id: MATCH_ID,
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

function stubFetch(points: PointRead[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === `/api/matches/${MATCH_ID}/points`)
        return Promise.resolve(Response.json(points));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderChart() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RallyIntensityChart matchId={MATCH_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("numbers games continuously across the match, not restarting each set", async () => {
  const points = [
    // Set 1: two games.
    point({ game_number: 1, won: true, is_game_end: true }),
    point({ game_number: 2, won: false, is_game_end: true, set_number: 1 }),
    point({ game_number: 2, won: false, is_game_end: true, set_number: 1, sequence: 1 }),
    // Set 2: game "1" again by its own raw number, but it's the match's 3rd game overall.
    point({ game_number: 1, won: true, is_game_end: true, set_number: 2 }),
  ];
  stubFetch(points);
  renderChart();

  await screen.findByText("Rally intensity, game by game");
  expect(screen.getByText("G1")).toBeInTheDocument();
  expect(screen.getByText("G2")).toBeInTheDocument();
  expect(screen.getByText("G3")).toBeInTheDocument();
});

test("a game's bar height reflects the share of its points running past 5 shots", async () => {
  const points = [
    point({ game_number: 1, won: true, rally_length_bucket: "b1" }),
    point({ game_number: 1, won: true, rally_length_bucket: "b3" }),
    point({ game_number: 1, won: true, is_game_end: true, rally_length_bucket: "b4" }),
  ];
  stubFetch(points);
  renderChart();

  await screen.findByText("Rally intensity, game by game");
  // 2 of 3 points (b3, b4) ran past 5 shots -> 67%.
  expect(
    screen.getByRole("img", { name: /G1, won, 67% of points past 5 shots/ }),
  ).toBeInTheDocument();
});

test("a game with no rally-length data gets an honest 'no data' bar, not a false 0%", async () => {
  stubFetch([point({ game_number: 1, won: true, is_game_end: true })]);
  renderChart();

  await screen.findByText("Rally intensity, game by game");
  expect(screen.getByRole("img", { name: "G1, no rally length recorded" })).toBeInTheDocument();
});

test("shows an empty state when the match has no points yet", async () => {
  stubFetch([]);
  renderChart();

  expect(await screen.findByText("No points recorded for this match yet.")).toBeInTheDocument();
});

test("shows a real error on a failed load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 }))),
  );
  renderChart();

  expect(
    await screen.findByText("Could not load this match's rally intensity."),
  ).toBeInTheDocument();
});
