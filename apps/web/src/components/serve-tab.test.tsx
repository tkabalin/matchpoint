import type { ServeStats } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { ServeTab } from "./serve-tab";

// The headline % in is `landed + ace`, not the plain "landed" bucket alone —
// 68 + 8 = 76 on the serving side (serve-tab.test.tsx's own regression case
// below), 61 + 8 = 69 on the returning side.
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
      first_serve: { net: 55, long: 20, wide: 25 },
      second_serve: { net: 38, long: 34, wide: 28 },
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
    fault_mode: { first_serve: null, second_serve: null },
    return_outcome: {
      first_serve: [
        { label: "In", value: 74, max: 100 },
        { label: "Net", value: 11, max: 100 },
        { label: "Long", value: 9, max: 100 },
        { label: "Wide", value: 6, max: 100 },
      ],
      second_serve: [
        { label: "In", value: 86, max: 100 },
        { label: "Net", value: 7, max: 100 },
        { label: "Long", value: 4, max: 100 },
        { label: "Wide", value: 3, max: 100 },
      ],
    },
    trend: [
      { match: "M1", first_serve_in: 58, second_serve_in: 47 },
      { match: "M2", first_serve_in: 60, second_serve_in: 45 },
    ],
  },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/players/player-1/analytics/serve") {
        return Promise.resolve(Response.json(SERVE_STATS));
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

test("both serve cards render, headline and stack visible, drills collapsed", async () => {
  renderTab();

  expect(await screen.findByText("Your serve")).toBeInTheDocument();
  expect(screen.getByText("Their serve")).toBeInTheDocument();
  expect(screen.getAllByText("1st serves in")).toHaveLength(2);
  expect(screen.queryByText(/Fault mode/)).not.toBeInTheDocument();
});

// The headline used to reuse `stats.hero.value` directly (68%), which double
// counted against the ace segment drawn right below it — the true in rate
// (in + ace) is 76%. Locks the fix in so the two numbers can't drift apart
// again without a test noticing.
test("the headline % in includes aces, not just the plain-in outcome bucket", async () => {
  renderTab();

  expect(await screen.findByText("76%")).toBeInTheDocument();
  expect(screen.getByText("69%")).toBeInTheDocument();
});

test("tapping a card's header opens its own drill without affecting the other card", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Your serve");

  await user.click(screen.getByText("Your serve"));

  expect(await screen.findByText(/Fault mode/)).toBeInTheDocument();
  expect(screen.queryByText(/Your return outcome/)).not.toBeInTheDocument();
});

// The returning card can never have a fault mode — capture records where the
// tracked player's own serve missed and nothing about the opponent's — so it
// shows the return-outcome drill instead, never both.
test("both cards' drills can be open at the same time, each showing its own drill", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Your serve");

  await user.click(screen.getByText("Your serve"));
  await user.click(screen.getByText("Their serve"));

  expect(await screen.findByText(/Fault mode/)).toBeInTheDocument();
  expect(screen.getByText(/Your return outcome/)).toBeInTheDocument();
  expect(screen.queryByText(/Their fault mode/)).not.toBeInTheDocument();
});

test("their serve's drill shows your return outcome, not a fault mode", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Their serve");

  await user.click(screen.getByText("Their serve"));

  expect(await screen.findByText(/Your return outcome/)).toBeInTheDocument();
  expect(screen.queryByText(/Fault mode/)).not.toBeInTheDocument();
});

test("switching 1st/2nd serve changes the fault-mode numbers shown", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Your serve");
  await user.click(screen.getByText("Your serve"));
  await screen.findByText(/Fault mode/);

  expect(screen.getByText("55%")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "2nd serve" }));

  expect(screen.getByText("38%")).toBeInTheDocument();
  expect(screen.queryByText("55%")).not.toBeInTheDocument();
});

// The hero and outcome stack used to stay frozen on the 1st-serve numbers no
// matter what the toggle said, so a coach reading "2nd serve" fault mode saw
// it sitting under a headline that was still describing the 1st serve.
test("switching 1st/2nd serve also updates the headline and outcome stack above it", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Your serve");
  await user.click(screen.getByText("Your serve"));
  await screen.findByText(/Fault mode/);

  expect(screen.getAllByText("1st serves in")).toHaveLength(2);
  expect(screen.getByText("76%")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "2nd serve" }));

  expect(screen.getByText("2nd serves in")).toBeInTheDocument();
  expect(screen.getByText("88%")).toBeInTheDocument();
  expect(screen.queryByText("76%")).not.toBeInTheDocument();
});

// Guards the jsdom chart harness itself, not just this chart. recharts'
// ResponsiveContainer keeps its initial size only while ResizeObserver is undefined, so
// the no-op stub `test-setup.ts` used to install left every chart in the suite measuring
// 0×0 and rendering null. Nothing failed — the charts were simply absent, and the axis
// formatter asserted on here had never once run.
test("each side's trend chart draws, with its y axis formatted as percentages", async () => {
  renderTab();
  await screen.findByText("Your serve");

  // One per side, and "100%" rather than "0%" because the latter also occurs as a
  // legitimate stat value elsewhere on the tab.
  expect(await screen.findAllByText("100%")).toHaveLength(2);
});
