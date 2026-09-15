import type { MatchRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerSurfaceRecordCard } from "./player-surface-record-card";

function makeMatch(overrides: Partial<MatchRead> = {}): MatchRead {
  return {
    id: "match-1",
    player_id: "player-1",
    played_on: "2026-08-01",
    opponent_name: null,
    event: null,
    result: null,
    result_reason: null,
    scoring_system: null,
    surface: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function stubFetch(matches: MatchRead[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/matches") return Promise.resolve(Response.json(matches));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerSurfaceRecordCard playerId="player-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows a win/loss row per surface actually played, newest enum order", async () => {
  stubFetch([
    makeMatch({ id: "m1", surface: "hard", result: "win" }),
    makeMatch({ id: "m2", surface: "hard", result: "loss" }),
    makeMatch({ id: "m3", surface: "clay", result: "win" }),
  ]);
  renderCard();

  expect(await screen.findByText("Performance by surface")).toBeInTheDocument();
  expect(screen.getByText("Hard")).toBeInTheDocument();
  expect(screen.getByText("1W – 1L")).toBeInTheDocument();
  expect(screen.getByText("Clay")).toBeInTheDocument();
  expect(screen.getByText("1W – 0L")).toBeInTheDocument();
  expect(screen.queryByText("Grass")).not.toBeInTheDocument();
});

// A match can carry a surface before it carries a result (in progress), or a
// result before a surface was ever picked (old data) — only a match with both
// belongs in a win/loss row.
test("excludes a match missing either a surface or a result", async () => {
  stubFetch([
    makeMatch({ id: "m1", surface: "hard", result: null }),
    makeMatch({ id: "m2", surface: null, result: "win" }),
  ]);
  renderCard();

  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("Performance by surface")).not.toBeInTheDocument();
});

test("renders nothing rather than an empty card with no matches at all", async () => {
  stubFetch([]);
  renderCard();

  await vi.waitFor(() =>
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("Performance by surface")).not.toBeInTheDocument();
});

test("shows a real error on a failed load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 }))),
  );
  renderCard();

  expect(await screen.findByText("Could not load performance by surface.")).toBeInTheDocument();
});
