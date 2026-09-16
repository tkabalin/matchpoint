import type { ServeStats } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { expect, test, vi, afterEach } from "vitest";

import { ServeTab } from "./serve-tab";

// The opponent card's "In" share pools both serve numbers' return-outcome rows on
// the returns behind them: 74 of 100 first serves and 43 of 50 second ones (the
// regression case below).
const SERVE_STATS: ServeStats = {
  serving: {
    breakdown: [],
    hero: null,
    metrics: [],
    outcome: {
      first_serve: { landed: 68, fault: 24, ace: 8 },
      second_serve: { landed: 85, fault: 12, ace: 3 },
    },
    fault_mode: {
      first_serve: { net: 55, long: 20, wide: 25, net_count: 11, long_count: 4, wide_count: 5 },
      second_serve: { net: 38, long: 34, wide: 28, net_count: 19, long_count: 17, wide_count: 14 },
    },
    return_outcome: { first_serve: [], second_serve: [] },
    trend: [
      { match: "M1", first_serve_in: 61, second_serve_in: 52 },
      { match: "M2", first_serve_in: 64, second_serve_in: 49 },
    ],
  },
  returning: {
    breakdown: [],
    hero: null,
    metrics: [],
    outcome: {
      first_serve: { landed: 61, fault: 31, ace: 8 },
      second_serve: { landed: 80, fault: 15, ace: 5 },
    },
    // Always null on the returning side — capture records where the tracked
    // player's own serve missed and nothing about the opponent's (see
    // `FaultModeSplit`'s own doc comment in the generated client).
    fault_mode: { first_serve: null, second_serve: null },
    return_outcome: {
      first_serve: [
        { label: "In", value: 74, count: 74, max: 100 },
        { label: "Net", value: 11, count: 11, max: 100 },
        { label: "Long", value: 9, count: 9, max: 100 },
        { label: "Wide", value: 6, count: 6, max: 100 },
      ],
      second_serve: [
        { label: "In", value: 86, count: 43, max: 100 },
        { label: "Net", value: 7, count: 3, max: 100 },
        { label: "Long", value: 4, count: 2, max: 100 },
        { label: "Wide", value: 3, count: 2, max: 100 },
      ],
    },
    trend: [
      { match: "M1", first_serve_in: 58, second_serve_in: 47 },
      { match: "M2", first_serve_in: 60, second_serve_in: 45 },
    ],
  },
};

function stubFetch(stats: ServeStats = SERVE_STATS) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/serve") {
        return Promise.resolve(Response.json(stats));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

function renderTab(stats?: ServeStats) {
  stubFetch(stats);
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

test("both serve cards render under their new titles", async () => {
  renderTab();

  expect(await screen.findByText("Your serve")).toBeInTheDocument();
  expect(screen.getByText("Return of opponent serve")).toBeInTheDocument();
  expect(screen.queryByText("Their serve")).not.toBeInTheDocument();
});

// Both permanent, no toggle to switch between them and no drill to open first.
test("Your serve shows a 1st serve bar directly above a 2nd serve bar, with visible percentages", async () => {
  renderTab();
  const card = (await screen.findByText("Your serve")).closest(".flex.flex-col") as HTMLElement;
  const scope = within(card);

  // "1st serve"/"2nd serve" each appear twice on this card: once as the
  // outcome row's own label, once again labelling that serve number's
  // fault-mode court further down.
  expect(scope.getAllByText("1st serve")).toHaveLength(2);
  expect(scope.getAllByText("2nd serve")).toHaveLength(2);
  // landed + ace: 68 + 8, and 85 + 3.
  expect(scope.getByText("76% in")).toBeInTheDocument();
  expect(scope.getByText("88% in")).toBeInTheDocument();
  expect(scope.getByText("24% fault")).toBeInTheDocument();
  expect(scope.getByText("8% ace")).toBeInTheDocument();
});

test("the 1st serve row appears before the 2nd serve row in the document", async () => {
  renderTab();
  await screen.findByText("Your serve");

  // "76% in" / "88% in" are each unique to their own outcome row's headline
  // number, unlike the "1st serve"/"2nd serve" labels which also repeat on
  // the fault-mode courts further down the same card.
  const first = screen.getByText("76% in");
  const second = screen.getByText("88% in");
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("there is no drill-down control and no 1st/2nd serve toggle", async () => {
  renderTab();
  await screen.findByText("Your serve");

  expect(screen.queryByRole("button", { name: "Your serve" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "2nd serve" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "1st or 2nd serve" })).not.toBeInTheDocument();
});

test("the trend graphs are gone", async () => {
  renderTab();
  await screen.findByText("Your serve");

  expect(screen.queryByText(/per match/)).not.toBeInTheDocument();
  expect(screen.queryByText("Serve % in")).not.toBeInTheDocument();
});

test("Your serve shows two fault-mode courts, one per serve number", async () => {
  renderTab();
  const card = (await screen.findByText("Your serve")).closest(".flex.flex-col") as HTMLElement;
  const scope = within(card);

  expect(
    scope.getByRole("img", { name: "Fault mode: net 11, long 4, wide 5" }),
  ).toBeInTheDocument();
  expect(
    scope.getByRole("img", { name: "Fault mode: net 19, long 17, wide 14" }),
  ).toBeInTheDocument();
});

// The whole point of this card: not what share of the opponent's serve landed in,
// but what the tracked player did with it — one bar, in vs. error.
test("Return of opponent serve shows one return-in-vs-error bar, combined across both serve numbers", async () => {
  renderTab();
  await screen.findByText("Return of opponent serve");

  // 117 of 150 returns = 78%, not the 80% averaging 74% and 86% unweighted gives
  // (#295). Shown once as the headline and again in the legend chip below it.
  expect(screen.getAllByText("78% in")).toHaveLength(2);
  expect(screen.getByText("22% error")).toBeInTheDocument();
});

test("Return of opponent serve shows one fault-mode court, combined from both serve numbers' return-outcome breakdown (not the always-null fault_mode field)", async () => {
  renderTab();
  const card = (await screen.findByText("Return of opponent serve")).closest(
    ".flex.flex-col",
  ) as HTMLElement;
  const scope = within(card);

  expect(scope.queryByText(/No faults on this serve yet/)).not.toBeInTheDocument();
  // Counts, not the percentages behind them: {Net:11, Long:9, Wide:6} +
  // {Net:3, Long:2, Wide:2} = net 14, long 11, wide 8 of 33.
  expect(scope.getAllByRole("img")).toHaveLength(1);
  expect(
    scope.getByRole("img", { name: "Fault mode: net 14, long 11, wide 8" }),
  ).toBeInTheDocument();
});

test("the opponent card's fault court holds at zero when no return faulted", async () => {
  const stats: ServeStats = {
    ...SERVE_STATS,
    returning: {
      ...SERVE_STATS.returning,
      return_outcome: {
        first_serve: [
          { label: "In", value: 100, count: 12, max: 100 },
          { label: "Net", value: 0, count: 0, max: 100 },
          { label: "Long", value: 0, count: 0, max: 100 },
          { label: "Wide", value: 0, count: 0, max: 100 },
        ],
        second_serve: [],
      },
    },
  };
  renderTab(stats);
  const card = (await screen.findByText("Return of opponent serve")).closest(
    ".flex.flex-col",
  ) as HTMLElement;
  const scope = within(card);

  expect(scope.getByRole("img", { name: "Fault mode: net 0, long 0, wide 0" })).toBeInTheDocument();
});

test("shows an empty state for a serve number that's never been attempted", async () => {
  const stats: ServeStats = {
    ...SERVE_STATS,
    serving: {
      ...SERVE_STATS.serving,
      outcome: { first_serve: SERVE_STATS.serving.outcome.first_serve, second_serve: null },
      fault_mode: { first_serve: SERVE_STATS.serving.fault_mode.first_serve, second_serve: null },
    },
  };
  renderTab(stats);
  await screen.findByText("Your serve");

  expect(screen.getByText("No 2nd serves recorded yet.")).toBeInTheDocument();
  expect(screen.getByText("No faults on this serve yet.")).toBeInTheDocument();
});

test("shows an empty state when the opponent card has no returns recorded at all", async () => {
  const stats: ServeStats = {
    ...SERVE_STATS,
    returning: {
      ...SERVE_STATS.returning,
      return_outcome: { first_serve: [], second_serve: [] },
    },
  };
  renderTab(stats);
  await screen.findByText("Return of opponent serve");

  expect(screen.getByText("No returns recorded yet.")).toBeInTheDocument();
  expect(screen.getByText("No faults on this serve yet.")).toBeInTheDocument();
});
