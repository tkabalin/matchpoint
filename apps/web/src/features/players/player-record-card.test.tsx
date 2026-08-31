import type { PlayerOverview } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerRecordCard } from "./player-record-card";

const OVERVIEW: PlayerOverview = {
  all_time_record: { wins: 52, losses: 28 },
  season_record: { wins: 14, losses: 6 },
  form: {
    label: "Form",
    value: 80,
    unit: "percent",
    sample_size: "n=5",
    baseline: 62,
    delta: 12,
    max: 100,
    higher_is_better: true,
  },
  hold_percentage: null,
  return_games_won: null,
  forced_to_unforced: null,
  recent_results: ["win", "win", "loss", "win", "win"],
};

function stubFetch(overview: PlayerOverview = OVERVIEW) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/overview") {
        return Promise.resolve(Response.json(overview));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderCard(opponentId: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerRecordCard playerId="player-1" opponentId={opponentId} />
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the all-time win/loss record, no season row", async () => {
  stubFetch();
  renderCard();

  expect(await screen.findByText("Win/loss record")).toBeInTheDocument();
  expect(screen.getByText("All-time")).toBeInTheDocument();
  expect(screen.getByText("52W – 28L")).toBeInTheDocument();
  expect(screen.queryByText("Season")).not.toBeInTheDocument();
  expect(screen.queryByText("14W – 6L")).not.toBeInTheDocument();
});

test("shows recent form in the same card", async () => {
  stubFetch();
  renderCard();

  expect(await screen.findByText("Recent form · last 5")).toBeInTheDocument();
  expect(screen.getByText("4W – 1L")).toBeInTheDocument();
});

// `aria-label` on a bare `<span>` isn't announced by most screen readers — no
// role means no accessible name is exposed. `role="img"` is what makes it one.
test("each result dot is announced as Won or Lost, not just shown by fill", async () => {
  stubFetch();
  renderCard();
  await screen.findByText("Recent form · last 5");

  const dots = screen.getAllByRole("img");
  expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
    "Won",
    "Won",
    "Lost",
    "Won",
    "Won",
  ]);
});

// The opponent scope isn't threaded through to the query yet (#244's real
// dropdown lands separately, see player-record-card.tsx's own comment) — the
// prop is accepted for the caller's sake but recent form stays unscoped.
test("recent form isn't yet scoped by the chosen opponent", async () => {
  stubFetch();
  renderCard("sarah-k");

  expect(await screen.findByText("Recent form · last 5")).toBeInTheDocument();
  expect(screen.getByText("4W – 1L")).toBeInTheDocument();
});

test("hides recent form for a player with no matches at all", async () => {
  stubFetch({ ...OVERVIEW, recent_results: [] });
  renderCard();

  await screen.findByText("Win/loss record");
  expect(screen.queryByText(/Recent form/)).not.toBeInTheDocument();
});
