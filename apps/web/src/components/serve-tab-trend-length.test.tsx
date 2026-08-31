import type { ServeSideStats, ServeStats, ServeTrendPoint } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ServeTab } from "./serve-tab";

// The fixture always produces a 6-point trend elsewhere in this suite, so the
// 0/1-point guard (#232: a match-scoped request returns at most one point,
// and a side that never served returns none) needs its own file with a
// hand-built payload.
let trendLength: 0 | 1 = 0;

const OUTCOME = { landed: 60, fault: 30, ace: 10 };
const FAULT_MODE = { net: 40, long: 30, wide: 30 };

function statsWithTrend(length: 0 | 1): ServeStats {
  const trend: ServeTrendPoint[] =
    length === 1 ? [{ match: "M1", first_serve_in: 65, second_serve_in: 50 }] : [];
  const side: ServeSideStats = {
    breakdown: [],
    hero: null,
    metrics: [],
    outcome: { first_serve: OUTCOME, second_serve: OUTCOME },
    fault_mode: { first_serve: FAULT_MODE, second_serve: FAULT_MODE },
    return_outcome: { first_serve: [], second_serve: [] },
    trend,
  };
  return { serving: side, returning: side };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/serve") {
        return Promise.resolve(Response.json(statsWithTrend(trendLength)));
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
      <ServeTab playerId="player-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("no trend line, and no crash, when a side has never served", async () => {
  trendLength = 0;
  renderTab();

  // Both cards share the same empty trend here, so this is two matches, not one.
  expect(await screen.findAllByText("No matches with a serve recorded yet.")).toHaveLength(2);
});

test("a single-match trend reads as one match, not a chart with an invisible line", async () => {
  trendLength = 1;
  renderTab();

  expect(await screen.findAllByText("One match so far, which is not yet a trend.")).toHaveLength(2);
});
