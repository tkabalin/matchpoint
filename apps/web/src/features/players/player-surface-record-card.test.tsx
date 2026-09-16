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
  return render(
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
  expect(screen.getByText("Clay")).toBeInTheDocument();
  expect(screen.queryByText("Grass")).not.toBeInTheDocument();
  // Hard: 1 win, 1 loss. Clay: 1 win, 0 losses — each count rendered
  // separately next to its own tick/cross icon, not a combined "1W – 1L" string.
  expect(screen.getAllByText("1")).toHaveLength(3);
  expect(screen.getByText("0")).toBeInTheDocument();
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

// The panel is painted the real court colour capture itself uses, not an
// abstract categorical swatch — a coach recognises clay by its colour
// already, so this mocks the court rather than inventing a second language.
test("paints each surface's panel with its own real-court-colour texture", async () => {
  stubFetch([
    makeMatch({ id: "m1", surface: "hard", result: "win" }),
    makeMatch({ id: "m2", surface: "clay", result: "win" }),
  ]);
  const { container } = renderCard();
  await screen.findByText("Performance by surface");

  expect(container.querySelector(".pattern-surface-hard")).toBeInTheDocument();
  expect(container.querySelector(".pattern-surface-clay")).toBeInTheDocument();
});

// The court-line diagram is drawn on top of the same panel the pattern paints
// and the mask reveals — a coach should see an actual (simplified) court,
// not just a colour swatch.
test("draws a simplified court-line diagram on every panel", async () => {
  stubFetch([makeMatch({ id: "m1", surface: "hard", result: "win" })]);
  const { container } = renderCard();
  await screen.findByText("Performance by surface");

  expect(container.querySelectorAll("svg line").length).toBeGreaterThan(0);
});

test("shows a real error on a failed load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response("boom", { status: 500 }))),
  );
  renderCard();

  expect(await screen.findByText("Could not load performance by surface.")).toBeInTheDocument();
});
