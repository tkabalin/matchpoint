import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { vi } from "vitest";

import type { ServeStats } from "@/lib/analytics/types.provisional";

import { ServeTab } from "./serve-tab";

// The fixture layer always produces a 6-point trend, so the 0/1-point guard
// (#232: a match-scoped request returns at most one point, and a side that
// never served returns none) needs its own file where getServeStatsOptions is
// mocked to a hand-built payload — module mocks are file-scoped, and every
// other serve-tab test needs the real fixture.
let trendLength: 0 | 1 = 0;

vi.mock("@/lib/analytics/analytics-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/analytics-options")>();
  return {
    ...actual,
    getServeStatsOptions: () =>
      queryOptions({
        queryKey: ["serve-stats-trend-length-test", trendLength],
        queryFn: () => Promise.resolve(statsWithTrend(trendLength)),
      }),
  };
});

const OUTCOME = { in: 60, fault: 30, ace: 10 };
const FAULT_MODE = { net: 40, long: 30, wide: 30 };

function statsWithTrend(length: 0 | 1): ServeStats {
  const trend = length === 1 ? [{ match: "M1", firstServeIn: 65, secondServeIn: 50 }] : [];
  const side = {
    outcome: { firstServe: OUTCOME, secondServe: OUTCOME },
    faultMode: { firstServe: FAULT_MODE, secondServe: FAULT_MODE },
    trend,
  };
  return {
    serving: side,
    returning: { ...side, returnOutcome: { firstServe: [], secondServe: [] } },
  };
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServeTab playerId="player-1" />
    </QueryClientProvider>,
  );
}

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
