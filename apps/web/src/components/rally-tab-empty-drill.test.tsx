import type { RallyStats } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { RallyTab } from "./rally-tab";

// A point-ender style with count > 0 and no breakdown is legitimate: a point
// ending on a missed return records no shot and no final ball, so it counts
// toward the card and appears in none of its drills (#232). The real API
// never produces this shape from the fixed demo season, so it needs its own
// hand-built payload.
const EMPTY_DETAIL = {
  wing: { forehand: 0, backhand: 0 },
  shot_type: [],
  court_zones: [],
  unusual_reasons: null,
};

const RALLY_STATS: RallyStats = {
  errors_overall: null,
  errors_under_pressure: null,
  hero: {
    label: "Forced : Unforced ratio",
    value: 1.0,
    unit: "ratio",
    sample_size: "n=1",
    baseline: null,
    delta: null,
    max: 3,
    higher_is_better: true,
  },
  won: 3,
  lost: 4,
  lost_by_shot: [],
  won_by_shot: [],
  outcome_mix: [],
  shot_frequency: { you: [], opponents: [] },
  rally_length: [{ label: "1-2 shots", count: 7 }],
  average_rally_length: { won: 2, lost: 2 },
  trend: [],
  styles: {
    you: [
      { kind: "forced", label: "Forced (their pressure)", count: 0, detail: EMPTY_DETAIL },
      { kind: "unforced", label: "Unforced (their free error)", count: 3, detail: EMPTY_DETAIL },
      {
        kind: "unusual",
        label: "Unusual (in your favor)",
        count: 1,
        detail: { wing: null, shot_type: [], court_zones: [], unusual_reasons: null },
      },
    ],
    opponents: [
      { kind: "forced", label: "Forced (your pressure)", count: 0, detail: EMPTY_DETAIL },
      { kind: "unforced", label: "Unforced (your free error)", count: 4, detail: EMPTY_DETAIL },
      { kind: "unusual", label: "Unusual (against you)", count: 0, detail: EMPTY_DETAIL },
    ],
  },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/rally") {
        return Promise.resolve(Response.json(RALLY_STATS));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderTab() {
  stubFetch();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RallyTab playerId="player-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("an unforced style with a real count but no breakdown says so instead of showing bare headings", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Point enders");

  await user.click(screen.getByRole("button", { name: /^Unforced/ }));

  expect(
    await screen.findByText(
      "These 3 points ended without a shot to record, so there is nothing to break down.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
  expect(screen.queryByText("Shot type")).not.toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

test("an unusual style with no wing and no reasons says so, singular count included", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Point enders");

  await user.click(screen.getByRole("button", { name: /^Unusual/ }));

  expect(
    await screen.findByText(
      "This point ended without a shot to record, so there is nothing to break down.",
    ),
  ).toBeInTheDocument();
});
