import type { PointRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { MomentumCard } from "./momentum-card";

const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000002";

// Same fixture shape as momentum.test.ts's own `point()` — this file exercises
// the rendered card, that one the pure `deriveSets` logic underneath it.
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

function lovGameWonByTracked(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true, is_game_end: true }),
  ];
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

function renderCard(matchFinished = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MomentumCard matchId={MATCH_ID} matchFinished={matchFinished} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows nothing below the chart for a match with no notes at all", async () => {
  stubFetch(lovGameWonByTracked(1));
  renderCard();

  await screen.findByText("Momentum");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});

test("lists a note under the chart, labelled by exactly where it was captured", async () => {
  const points = lovGameWonByTracked(1).map((p, i) =>
    i === 1 ? { ...p, note: "Double faulting under pressure" } : p,
  );
  stubFetch(points);
  renderCard();
  await screen.findByText("Momentum");

  const item = screen.getByRole("listitem");
  expect(item).toHaveTextContent("Set 1, Game 1: Double faulting under pressure");
});

// Multiple notes in one game still list separately, each carrying that same
// game's own label rather than folding into one combined entry.
test("multiple notes in the same game each get their own labelled line", async () => {
  const points = lovGameWonByTracked(1).map((p, i) => {
    if (i === 0) return { ...p, note: "Rushing the net on short balls" };
    if (i === 2) return { ...p, note: "Second serve toss too low" };
    return p;
  });
  stubFetch(points);
  renderCard();
  await screen.findByText("Momentum");

  const items = screen.getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Set 1, Game 1: Rushing the net on short balls",
    "Set 1, Game 1: Second serve toss too low",
  ]);
});

// Notes belong to the game they were captured in, not the whole set — a note
// in game 2 must carry that game's own label, not game 1's.
test("a note in one game carries that game's own label, not a different game's", async () => {
  const points = [
    ...lovGameWonByTracked(1),
    ...lovGameWonByTracked(2).map((p, i) =>
      i === 0 ? { ...p, note: "Serving big in game 2" } : p,
    ),
  ];
  stubFetch(points);
  renderCard();
  await screen.findByText("Momentum");

  const item = screen.getByRole("listitem");
  expect(item).toHaveTextContent("Set 1, Game 2: Serving big in game 2");
});

test("explains what the bars encode, behind the header's info button", async () => {
  const user = userEvent.setup({ delay: null });
  stubFetch(lovGameWonByTracked(1));
  renderCard();

  await user.click(await screen.findByRole("button", { name: "Explain momentum" }));

  expect(await screen.findByText(/One bar per completed game/)).toBeInTheDocument();
});

test("explains what the break-of-serve dot means", async () => {
  stubFetch(lovGameWonByTracked(1));
  renderCard();

  expect(await screen.findByText("Break of serve")).toBeInTheDocument();
});

test("shows a real error on a failed load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 }))),
  );
  renderCard();

  expect(await screen.findByText("Could not load this match's momentum.")).toBeInTheDocument();
});
