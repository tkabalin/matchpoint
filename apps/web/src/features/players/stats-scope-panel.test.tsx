import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import type { StatsFilters } from "@/lib/analytics/types.provisional";

import { StatsScopePanel } from "./stats-scope-panel";

const DEFAULT_FILTERS: StatsFilters = { scope: "all", opponentId: null, set: "all", phase: "full" };

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

function renderPanel(onApply = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness onApply={onApply} />
    </QueryClientProvider>,
  );
  return onApply;
}

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
    opponentId: null,
    set: "2",
    phase: "full",
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
    opponentId: null,
    set: "2",
    phase: "tiebreaks",
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
// opponentId: null }`, which reads as "Choose opponent" — an instruction
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
    opponentId: "sarah-k",
    set: "all",
    phase: "full",
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

test("picking an opponent and applying sets opponentId and echoes their name", async () => {
  const user = userEvent.setup({ delay: null });
  const onApply = renderPanel();
  await user.click(screen.getByText("All matches"));
  await user.click(screen.getByRole("button", { name: "vs opponent" }));
  await user.click(await screen.findByText("Sarah K"));
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(onApply).toHaveBeenCalledWith({
    scope: "vs-opponent",
    opponentId: "sarah-k",
    set: "all",
    phase: "full",
  });
  expect(await screen.findByText("Sarah K")).toBeInTheDocument();
});
