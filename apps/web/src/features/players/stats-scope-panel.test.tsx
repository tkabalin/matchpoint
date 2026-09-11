import type { MatchRead, OpponentSummary } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { StatsFilters } from "@/lib/analytics/types.provisional";

import { StatsScopePanel } from "./stats-scope-panel";

const DEFAULT_FILTERS: StatsFilters = {
  scope: "all",
  opponentKey: null,
  set: "all",
  phase: "full",
  surface: "all",
};

function makeMatch(overrides: Partial<MatchRead> = {}): MatchRead {
  return {
    id: "match-1",
    player_id: "player-1",
    played_on: "2026-08-01",
    opponent_name: null,
    event: null,
    result: null,
    scoring_system: null,
    surface: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// Already sorted most-met first, matching the real endpoint's own order — the
// panel's "Most played" group is the leading slice of this list, not a flag.
const OPPONENTS: OpponentSummary[] = [
  { key: "sarah-k", name: "Sarah K", matches: 14 },
  { key: "priya-m", name: "Priya M", matches: 9 },
  { key: "danny-g", name: "Danny G", matches: 6 },
  { key: "alex-t", name: "Alex T", matches: 5 },
];

function stubFetch(matches: MatchRead[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/opponents") {
        return Promise.resolve(Response.json(OPPONENTS));
      }
      if (pathname === "/api/matches") {
        return Promise.resolve(Response.json(matches));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

/** A real stateful parent — `StatsScopePanel` only echoes what it's actually
 *  given, so a test that checks the summary after Apply needs `filters` to
 *  really update, not a static prop a bare `vi.fn()` mock leaves frozen. */
function Harness({ onApply }: { onApply: (filters: StatsFilters) => void }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  return (
    <StatsScopePanel
      playerId="player-1"
      filters={filters}
      onApply={(next) => {
        setFilters(next);
        onApply(next);
      }}
    />
  );
}

function renderPanel(onApply = vi.fn(), matches: MatchRead[] = []) {
  stubFetch(matches);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness onApply={onApply} />
    </QueryClientProvider>,
  );
  return onApply;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("starts collapsed, showing the current filters as a summary", () => {
  renderPanel();

  expect(screen.getByText("All matches")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Match scope" })).not.toBeInTheDocument();
});

test("tapping the trigger expands the panel, not a popup", async () => {
  const user = userEvent.setup({ delay: null });
  renderPanel();

  await user.click(screen.getByText("All matches"));

  expect(screen.getByRole("group", { name: "Match scope" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("selecting chips doesn't commit until Apply", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));

  await user.click(screen.getByRole("button", { name: "Set 2" }));

  expect(onApply).not.toHaveBeenCalled();
  // Two now: the trigger row's own summary, and the still-expanded "All
  // matches" scope chip (the draft's scope hasn't changed, just its set).
  expect(screen.getAllByText("All matches")).toHaveLength(2);
});

test("Apply commits the draft, updates the summary, and closes the panel", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "Set 2" }));

  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "all",
    opponentKey: null,
    set: "2",
    phase: "full",
    surface: "all",
  });
  expect(await screen.findByText("All matches · Set 2")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Match scope" })).not.toBeInTheDocument();
});

// The summary used to show Set *or* Phase, whichever was chosen, never both —
// so Set 2 + Tiebreaks and Set 2 + Break points collapsed to the same string
// ("All matches · Set 2"), and the trigger row is the only feedback a coach
// has that both committed, since the panel closes on Apply.
test("Apply commits both Set and Phase, and the summary shows both together", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "Set 2" }));
  await user.click(screen.getByRole("button", { name: "Tiebreaks" }));

  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "all",
    opponentKey: null,
    set: "2",
    phase: "tiebreaks",
    surface: "all",
  });
  expect(await screen.findByText("All matches · Set 2 · Tiebreaks")).toBeInTheDocument();
});

test("the opponent picker only shows once scope is 'vs opponent', grouped by most played", async () => {
  const user = userEvent.setup({ delay: null });
  renderPanel();
  await user.click(screen.getByText("All matches"));

  expect(screen.queryByText("Sarah K")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "vs opponent" }));

  expect(await screen.findByText("Sarah K")).toBeInTheDocument();
  expect(screen.getByText("Most played")).toBeInTheDocument();
  expect(screen.getByText("All opponents")).toBeInTheDocument();
});

// Applying with nobody picked used to commit `{ scope: "vs-opponent",
// opponentKey: null }`, which reads as "Choose opponent" — an instruction
// sitting where a committed value belongs — and quietly fell back to the
// all-matches record for Recent Form.
test("Apply is disabled for 'vs opponent' until an opponent is actually picked", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "vs opponent" }));
  await screen.findByText("Sarah K");

  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

  await user.click(screen.getByText("Sarah K"));

  expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "vs-opponent",
    opponentKey: "sarah-k",
    set: "all",
    phase: "full",
    surface: "all",
  });
});

test("searching the opponent list filters it", async () => {
  const user = userEvent.setup({ delay: null });
  renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "vs opponent" }));
  await screen.findByText("Sarah K");

  await user.type(screen.getByPlaceholderText("Search opponents"), "Alex");

  expect(screen.getByText("Alex T")).toBeInTheDocument();
  expect(screen.queryByText("Sarah K")).not.toBeInTheDocument();
});

test("picking an opponent and applying sets opponentKey and echoes their name", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "vs opponent" }));
  await user.click(await screen.findByText("Sarah K"));
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "vs-opponent",
    opponentKey: "sarah-k",
    set: "all",
    phase: "full",
    surface: "all",
  });
  expect(await screen.findByText("Sarah K")).toBeInTheDocument();
});

// #225: the panel offers a surface only where the player actually has a match on
// it, so a player who has only ever played on hard shouldn't see three dead chips.
test("the surface chip row is absent until the player has a match with a surface logged", async () => {
  renderPanel(vi.fn(), [makeMatch({ surface: null })]);

  await userEvent.setup({ delay: null }).click(screen.getByText("All matches"));

  expect(screen.queryByRole("group", { name: "Surface" })).not.toBeInTheDocument();
});

test("the surface chip row only offers surfaces the player has actually played on", async () => {
  const user = userEvent.setup({ delay: null });
  renderPanel(vi.fn(), [
    makeMatch({ id: "m1", surface: "hard" }),
    makeMatch({ id: "m2", surface: "clay" }),
  ]);

  await user.click(screen.getByText("All matches"));

  const surfaceGroup = await screen.findByRole("group", { name: "Surface" });
  expect(screen.getByRole("button", { name: "All surfaces" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hard" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clay" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Grass" })).not.toBeInTheDocument();
  expect(surfaceGroup).toBeInTheDocument();
});

test("committing a surface updates the summary and calls onApply with it", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel(vi.fn(), [makeMatch({ surface: "clay" })]);
  await user.click(screen.getByText("All matches"));
  await user.click(await screen.findByRole("button", { name: "Clay" }));

  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "all",
    opponentKey: null,
    set: "all",
    phase: "full",
    surface: "clay",
  });
  expect(await screen.findByText("All matches · Clay")).toBeInTheDocument();
});
