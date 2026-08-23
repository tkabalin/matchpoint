import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ServeTab } from "./serve-tab";

// A fixture can never reject, so the error branch needs its own file where
// `getServeStatsOptions` is mocked to — module mocks are file-scoped, and
// every other serve-tab test needs the real, always-resolving fixture.
vi.mock("@/lib/analytics/analytics-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/analytics-options")>();
  return {
    ...actual,
    getServeStatsOptions: () =>
      queryOptions({
        queryKey: ["serve-stats-error-test"],
        queryFn: () => Promise.reject(new Error("network down")),
      }),
  };
});

test("shows a load-failure message instead of an indefinite skeleton", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServeTab playerId="player-1" />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Could not load serve stats.")).toBeInTheDocument();
});
