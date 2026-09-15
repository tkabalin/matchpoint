import type { RallyStats } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { RallyTab } from "./rally-tab";

const RALLY_STATS: RallyStats = {
  errors_overall: null,
  errors_under_pressure: null,
  hero: {
    label: "Forced : Unforced ratio",
    value: 1.8,
    unit: "ratio",
    sample_size: "n=9",
    baseline: null,
    delta: null,
    max: 3,
    higher_is_better: true,
  },
  won: 5,
  lost: 4,
  lost_by_shot: [],
  outcome_mix: [],
  rally_length: [
    { label: "1-2 shots", count: 4 },
    { label: "3-5 shots", count: 3 },
    { label: "6-10 shots", count: 2 },
  ],
  average_rally_length: { won: 2.6, lost: 6.5 },
  trend: [],
  shot_frequency: {
    you: [
      { shot: "Drive", share: 0.5 },
      { shot: "Volley", share: 0.5 },
    ],
    opponents: [{ shot: "Drive", share: 1 }],
  },
  won_by_shot: [],
  styles: {
    you: [
      {
        kind: "forced",
        label: "Forced (their pressure)",
        count: 2,
        detail: {
          wing: { forehand: 1, backhand: 1 },
          shot_type: [{ label: "Drive", value: 2, max: 2 }],
          court_zones: [{ zone: "Net", count: 2 }],
          unusual_reasons: null,
        },
      },
      {
        // Realistic unforced shape: capture skips the shot-detail screen for
        // an unforced error entirely (`capture-flow.ts`), so wing and shot
        // type are always empty here — only the final-ball zone (captured on
        // an earlier step) can carry real data.
        kind: "unforced",
        label: "Unforced (their free error)",
        count: 2,
        detail: {
          wing: { forehand: 0, backhand: 0 },
          shot_type: [],
          court_zones: [{ zone: "Net", count: 2 }],
          unusual_reasons: null,
        },
      },
      {
        kind: "unusual",
        label: "Unusual (in your favor)",
        count: 1,
        detail: {
          wing: null,
          shot_type: [],
          court_zones: [],
          unusual_reasons: [{ label: "Net touch", value: 1, max: 1 }],
        },
      },
    ],
    opponents: [
      {
        kind: "forced",
        label: "Forced (your pressure)",
        count: 2,
        detail: {
          wing: { forehand: 1, backhand: 1 },
          shot_type: [],
          court_zones: [],
          unusual_reasons: null,
        },
      },
      {
        kind: "unforced",
        label: "Unforced (your free error)",
        count: 1,
        detail: {
          wing: { forehand: 0, backhand: 1 },
          shot_type: [],
          court_zones: [],
          unusual_reasons: null,
        },
      },
      {
        kind: "unusual",
        label: "Unusual (against you)",
        count: 1,
        detail: {
          wing: null,
          shot_type: [],
          court_zones: [],
          unusual_reasons: [{ label: "Point penalty", value: 1, max: 1 }],
        },
      },
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

test("shows the point-ender style cards, none open by default", async () => {
  renderTab();

  expect(await screen.findByText("Point enders")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Forced/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Unforced/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Unusual/ })).toBeInTheDocument();
  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

test("tapping a style card opens its drill", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  await user.click(screen.getByRole("button", { name: /^Forced/ }));

  expect(await screen.findByText("Wing: setup shot")).toBeInTheDocument();
  expect(screen.getByText("Final ball: where it landed")).toBeInTheDocument();
});

test("tapping the open card again collapses it", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  const forcedCard = screen.getByRole("button", { name: /^Forced/ });
  await user.click(forcedCard);
  await screen.findByText("Wing: setup shot");
  await user.click(forcedCard);

  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
});

test("tapping a different style card swaps the drill", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");
  await user.click(screen.getByRole("button", { name: /^Forced/ }));
  await screen.findByText("Wing: setup shot");

  await user.click(screen.getByRole("button", { name: /^Unusual/ }));

  expect(await screen.findByText("Reason")).toBeInTheDocument();
  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
});

// Unforced errors never carry a wing or shot type at all (capture skips that
// screen for them) — so those two sections are omitted outright, headings
// included, rather than shown with an empty-state placeholder underneath.
// Final ball can still have real data for an unforced error and keeps showing.
test("Unforced's drill omits Wing and Shot type entirely, but still shows Final ball", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  await user.click(screen.getByRole("button", { name: /^Unforced/ }));

  expect(await screen.findByText("Final ball: where it landed")).toBeInTheDocument();
  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
  expect(screen.queryByText("No setup shot recorded.")).not.toBeInTheDocument();
  expect(screen.queryByText("Shot type")).not.toBeInTheDocument();
  expect(screen.queryByText("No shot type recorded.")).not.toBeInTheDocument();
});

test("switching You won / You lost leaves the drill closed", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  expect(screen.getByText("Forced")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^You lost/ }));

  expect(screen.getByRole("button", { name: /^Forced/ })).toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

// `openStyle` used to survive the toggle: opening Forced under "You won" then
// switching to "You lost" silently re-resolved the same open card against
// the opponent's data, with no change to the heading that told a coach so.
test("switching sides while a drill is open closes it, rather than silently swapping its data", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");
  await user.click(screen.getByRole("button", { name: /^Forced/ }));
  await screen.findByText("Wing: setup shot");

  await user.click(screen.getByRole("button", { name: /^You lost/ }));

  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

// The heading no longer names a side ("Your"/"Their") — the Won/Lost toggle
// above it already says whose winning shot is being described.
test("the winning-shot heading stays the same across the Won/Lost toggle", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  expect(screen.getByText("Winning shot")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^You lost/ }));

  expect(screen.getByText("Winning shot")).toBeInTheDocument();
});

// `styles[wonSide]` describes the side that *didn't* win those points' own
// error, so the label names the opposite side from the toggle: "You won"
// shows the opponent's forced/unforced (their errors gave you the point),
// "You lost" shows your own.
test("the forced:unforced stat names the opposite side from the Won/Lost toggle, and updates with it", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  expect(screen.getByText("Opponent forced : unforced")).toBeInTheDocument();
  expect(screen.getByText("2 | 2")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^You lost/ }));

  expect(screen.getByText("Your forced : Unforced")).toBeInTheDocument();
  expect(screen.getByText("2 | 1")).toBeInTheDocument();
});

test("shows the rally-length distribution, uncaptioned in the middle", async () => {
  renderTab();

  expect(await screen.findByText("Rally length: how points are ending")).toBeInTheDocument();
  expect(screen.getByText("Short → often serve or return.")).toBeInTheDocument();
  expect(screen.getByText("Long → often fitness, not technique.")).toBeInTheDocument();
});
