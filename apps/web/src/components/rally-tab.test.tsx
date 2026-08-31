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
    { label: "1–3 shots", count: 4 },
    { label: "4–6 shots", count: 3 },
    { label: "7–9 shots", count: 2 },
  ],
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
        kind: "unforced",
        label: "Unforced (their free error)",
        count: 2,
        detail: {
          wing: { forehand: 1, backhand: 1 },
          shot_type: [],
          court_zones: [],
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

test("switching You won / They won leaves the drill closed", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  expect(screen.getByText("Forced")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^They won/ }));

  expect(screen.getByRole("button", { name: /^Forced/ })).toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

// `openStyle` used to survive the toggle: opening Forced under "You won" then
// switching to "They won" silently re-resolved the same open card against
// the opponent's data, with no change to the heading that told a coach so.
test("switching sides while a drill is open closes it, rather than silently swapping its data", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");
  await user.click(screen.getByRole("button", { name: /^Forced/ }));
  await screen.findByText("Wing: setup shot");

  await user.click(screen.getByRole("button", { name: /^They won/ }));

  expect(screen.queryByText("Wing: setup shot")).not.toBeInTheDocument();
  expect(screen.queryByText("Final ball: where it landed")).not.toBeInTheDocument();
});

test("switching sides changes the radar's title between Your and Their", async () => {
  const user = userEvent.setup({ delay: null });
  renderTab();
  await screen.findByText("Point enders");

  expect(screen.getByText("Your shot shape: wing × type")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^They won/ }));

  expect(await screen.findByText("Their shot shape: wing × type")).toBeInTheDocument();
});

test("the Forced/Unforced explanation defines them by pressure, not ball placement", async () => {
  renderTab();

  expect(
    await screen.findByText(/Forced means your shot put the opponent under real pressure/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/landed in or out/)).not.toBeInTheDocument();
});

test("shows the rally-length distribution, uncaptioned in the middle", async () => {
  renderTab();

  expect(await screen.findByText("Rally length: how points are ending")).toBeInTheDocument();
  expect(screen.getByText("Short → often serve or return.")).toBeInTheDocument();
  expect(screen.getByText("Long → often fitness, not technique.")).toBeInTheDocument();
});
