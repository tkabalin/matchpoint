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

function stubFetch(response: () => Response = () => Response.json(OVERVIEW)) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/overview") {
        return Promise.resolve(response());
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderCard({
  opponentKey = null,
  opponentName = null,
  surface = "all",
  onOpponentNotFound = vi.fn(),
}: {
  opponentKey?: string | null;
  opponentName?: string | null;
  surface?: "all" | "hard" | "clay" | "grass" | "carpet";
  onOpponentNotFound?: () => void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerRecordCard
        playerId="player-1"
        opponentKey={opponentKey}
        opponentName={opponentName}
        surface={surface}
        onOpponentNotFound={onOpponentNotFound}
      />
    </QueryClientProvider>,
  );
  return { queryClient, onOpponentNotFound };
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

test("names the opponent in the caption once one is scoped", async () => {
  stubFetch();
  renderCard({ opponentKey: "sarah-k", opponentName: "Sarah K" });

  expect(await screen.findByText("Recent form · last 5 vs Sarah K")).toBeInTheDocument();
});

test("hides recent form for a player with no matches at all", async () => {
  stubFetch(() => Response.json({ ...OVERVIEW, recent_results: [] }));
  renderCard();

  await screen.findByText("Win/loss record");
  expect(screen.queryByText(/Recent form/)).not.toBeInTheDocument();
});

// A stale opponent key (its matches renamed/deleted since the picker offered
// it) 404s — the card falls back to "all matches" via the callback rather
// than getting stuck on a permanent error or skeleton.
test("falls back to all matches when the opponent key 404s", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "No matches" }), { status: 404 }));
  const { onOpponentNotFound } = renderCard({ opponentKey: "gone", opponentName: "Gone" });

  await vi.waitFor(() => expect(onOpponentNotFound).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Win/loss record")).not.toBeInTheDocument();
});

test("shows a real error for a failure that isn't a stale opponent key", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));
  renderCard();

  expect(await screen.findByText("Could not load the win/loss record.")).toBeInTheDocument();
});

// #225: the record and form must narrow the same way the rest of the tab does.
test("sends the surface axis when one is scoped, and omits it for 'all'", async () => {
  let requestedUrl = "";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      requestedUrl = input.url;
      return Promise.resolve(Response.json(OVERVIEW));
    }),
  );
  renderCard({ surface: "clay" });

  await screen.findByText("Win/loss record");
  expect(new URL(requestedUrl).searchParams.get("surface")).toBe("clay");
});

test("omits the surface param entirely for the 'all' sentinel", async () => {
  let requestedUrl = "";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      requestedUrl = input.url;
      return Promise.resolve(Response.json(OVERVIEW));
    }),
  );
  renderCard();

  await screen.findByText("Win/loss record");
  expect(new URL(requestedUrl).searchParams.has("surface")).toBe(false);
});
