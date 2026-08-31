import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { RallyStats } from "@/lib/analytics/types.provisional";

import { RallyTab } from "./rally-tab";

// A point-ender style with count > 0 and no breakdown is legitimate: a point
// ending on a missed return records no shot and no final ball, so it counts
// toward the card and appears in none of its drills (#232). The fixture never
// produces this shape, so it needs its own file where getRallyStatsOptions is
// mocked to a hand-built payload.
const EMPTY_STYLE = {
  kind: "unforced" as const,
  label: "Unforced (their free error)",
  count: 3,
  detail: {
    wing: { forehand: 0, backhand: 0 },
    shotType: [],
    courtZones: [],
    unusualReasons: null,
  },
};
const EMPTY_UNUSUAL_STYLE = {
  kind: "unusual" as const,
  label: "Unusual (in your favor)",
  count: 1,
  detail: { wing: null, shotType: [], courtZones: [], unusualReasons: null },
};

const RALLY_STATS: RallyStats = {
  hero: {
    label: "Forced : Unforced ratio",
    value: 1.0,
    unit: "ratio",
    sampleSize: "n=1",
    baseline: null,
    delta: null,
    max: 3,
    higherIsBetter: true,
  },
  won: 3,
  lost: 4,
  shotFrequency: { you: [], opponents: [] },
  placementNote: { you: "", opponents: "" },
  styles: {
    you: [
      { kind: "forced", label: "Forced (their pressure)", count: 0, detail: EMPTY_STYLE.detail },
      EMPTY_STYLE,
      EMPTY_UNUSUAL_STYLE,
    ],
    opponents: [
      { kind: "forced", label: "Forced (your pressure)", count: 0, detail: EMPTY_STYLE.detail },
      {
        kind: "unforced",
        label: "Unforced (your free error)",
        count: 4,
        detail: EMPTY_STYLE.detail,
      },
      { kind: "unusual", label: "Unusual (against you)", count: 0, detail: EMPTY_STYLE.detail },
    ],
  },
  rallyLength: [{ label: "1–3 shots", count: 7 }],
};

vi.mock("@/lib/analytics/analytics-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/analytics-options")>();
  return {
    ...actual,
    getRallyStatsOptions: () =>
      queryOptions({
        queryKey: ["rally-stats-empty-drill-test"],
        queryFn: () => Promise.resolve(RALLY_STATS),
      }),
  };
});

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RallyTab playerId="player-1" />
    </QueryClientProvider>,
  );
}

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
