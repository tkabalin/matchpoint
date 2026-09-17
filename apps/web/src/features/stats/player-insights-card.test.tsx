import type { PlayerRead, RallyStats } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerInsightsCard } from "./player-insights-card";

function player(id: string, firstName: string, lastName: string): PlayerRead {
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    username: `${firstName}${lastName}`.toLowerCase(),
    date_of_birth: null,
    dominant_hand: null,
    gender: null,
    notes: null,
    coach_id: "coach-1",
    has_transfer_code: false,
    photo_url: null,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
  };
}

const EMPTY_DETAIL = { court_zones: [], shot_type: [], unusual_reasons: null, wing: null };

function rallyStats(overrides: Partial<RallyStats> = {}): RallyStats {
  return {
    average_rally_length: { won: null, lost: null },
    trend: [],
    lost: 0,
    lost_by_shot: [],
    rally_length: [],
    shot_frequency: { you: [], opponents: [] },
    styles: { you: [], opponents: [] },
    won: 0,
    won_by_shot: [],
    ...overrides,
  };
}

// Aggression 75% (you: 9 forced of 12), mistake resilience 25% (opponents: 1
// forced of 4) — the fixture used to spot-check position. Shortest average
// rally length of the plottable three (5 shots), for the size-bucket check.
const shortRally = player("p0", "Alex", "Chen");
const shortRallyStats = rallyStats({
  average_rally_length: { won: 5, lost: 5 },
  won: 10,
  lost: 10,
  styles: {
    you: [
      { kind: "forced", count: 9, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 3, label: "unforced", detail: EMPTY_DETAIL },
    ],
    opponents: [
      { kind: "forced", count: 1, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 3, label: "unforced", detail: EMPTY_DETAIL },
    ],
  },
});

// A player with no rally-ending points recorded at all yet — both axis scores
// come back null, so this player must be excluded from the grid entirely.
const noRallyData = player("p1", "Priya", "Singh");
const noRallyDataStats = rallyStats();

// Mid average rally length (10 shots) among the plottable three.
const midRally = player("p2", "Sam", "Rivera");
const midRallyStats = rallyStats({
  average_rally_length: { won: 10, lost: 10 },
  won: 10,
  lost: 10,
  styles: {
    you: [
      { kind: "forced", count: 5, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 5, label: "unforced", detail: EMPTY_DETAIL },
    ],
    opponents: [
      { kind: "forced", count: 6, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 4, label: "unforced", detail: EMPTY_DETAIL },
    ],
  },
});

// Longest average rally length (15 shots) among the plottable three.
const longRally = player("p3", "Rookie", "Ross");
const longRallyStats = rallyStats({
  average_rally_length: { won: 15, lost: 15 },
  won: 10,
  lost: 10,
  styles: {
    you: [
      { kind: "forced", count: 3, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 7, label: "unforced", detail: EMPTY_DETAIL },
    ],
    opponents: [
      { kind: "forced", count: 4, label: "forced", detail: EMPTY_DETAIL },
      { kind: "unforced", count: 6, label: "unforced", detail: EMPTY_DETAIL },
    ],
  },
});

const roster = [shortRally, noRallyData, midRally, longRally];

/** `gate`, when given, holds every stubbed response back until it settles, so a
 *  test can observe the loading state before the data arrives rather than racing
 *  a response that would otherwise resolve on the next microtask (#289). */
function stubFetch(statsByPlayerId: Record<string, RallyStats>, gate?: Promise<void>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const match = /^\/api\/players\/([^/]+)\/analytics\/rally$/.exec(pathname);
      if (match) {
        const stats = statsByPlayerId[match[1]!];
        if (!stats) throw new Error(`Unstubbed player id: ${match[1]}`);
        return gate === undefined
          ? Promise.resolve(Response.json(stats))
          : gate.then(() => Response.json(stats));
      }
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

/** Renders inside a real router (avatars link to a player's profile) and, unless
 *  told not to, waits for the per-player rally queries to settle — most tests
 *  care about the loaded grid, not the transient skeleton in between. */
function renderCard(players: PlayerRead[] = roster) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: () => <PlayerInsightsCard players={players} />,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const routeTree = rootRoute.addChildren([statsRoute, profileRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/stats"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

async function renderLoadedCard(players: PlayerRead[] = roster) {
  renderCard(players);
  await screen.findByText("Player insights");
  // vi.waitFor ignores test-setup.ts's asyncUtilTimeout and keeps vitest's own one
  // second, well under what a starved runner takes to settle four queries, so both
  // polls in this file state the suite's budget at the call site (docs/testing.md).
  await vi.waitFor(
    () => expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument(),
    { timeout: 5_000 },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows a loading skeleton, then the real grid", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  stubFetch(
    {
      [shortRally.id]: shortRallyStats,
      [noRallyData.id]: noRallyDataStats,
      [midRally.id]: midRallyStats,
      [longRally.id]: longRallyStats,
    },
    gate,
  );

  renderCard();

  await vi.waitFor(
    () => expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument(),
    { timeout: 5_000 },
  );
  release();
  await screen.findByRole("link", { name: "Alex Chen's player insights" });
  expect(document.querySelector('[data-slot="skeleton"]')).not.toBeInTheDocument();
});

test("renders an avatar only for players with a computable aggression and resilience score", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });

  await renderLoadedCard();

  expect(screen.getByRole("link", { name: "Alex Chen's player insights" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sam Rivera's player insights" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Rookie Ross's player insights" })).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Priya Singh's player insights" }),
  ).not.toBeInTheDocument();
});

test("positions an avatar via aggression (x) and mistake resilience (y), scaled to the plotted group's own range", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });

  await renderLoadedCard();

  const link = screen.getByRole("link", { name: "Alex Chen's player insights" });
  // Raw aggression 75% (9/(9+3)*100), raw resilience 25% (1/(1+3)*100). The
  // three plottable players' own aggression range is 30-75, so 75 (the
  // group's own max) scales to the padded band's own top: left 90%. Their
  // resilience range is 25-60, so 25 (the group's own min) scales to the
  // band's bottom: top 100-10 = 90% (CSS `top` grows downward, so a *low*
  // resilience, i.e. "high mistakes", sits toward the bottom).
  expect(link).toHaveStyle({ left: "90%", top: "90%" });
});

test("sizes each avatar by its own average rally length, relative to the plotted group's range", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });

  await renderLoadedCard();

  const shortLink = screen.getByRole("link", { name: "Alex Chen's player insights" });
  const longLink = screen.getByRole("link", { name: "Rookie Ross's player insights" });
  // PhotoAvatar's size classes: sm is size-7, xl is size-16 — the shortest and
  // longest average rally length in the group must land on different sizes.
  expect(within(shortLink).getByText("AC")).toHaveClass("size-7");
  expect(within(longLink).getByText("RR")).toHaveClass("size-16");
});

test("each avatar is a real link to that player's stats page", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });
  const user = userEvent.setup({ delay: null });
  await renderLoadedCard();

  await user.click(screen.getByRole("link", { name: "Alex Chen's player insights" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("notes how many players are excluded for having no rally data yet", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });

  await renderLoadedCard();

  expect(
    screen.getByText("1 player not shown. No rally data logged yet.", { exact: false }),
  ).toBeInTheDocument();
});

test("explains all three encodings as bullet points: position (both axes) and size (rally length)", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });

  await renderLoadedCard();

  const list = screen.getByRole("list");
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent(/aggressive/i);
  expect(items[1]).toHaveTextContent(/mistakes/i);
  expect(items[2]).toHaveTextContent(/rallies/i);
});

test("shows an empty state instead of a blank grid when no player has computable scores yet", async () => {
  stubFetch({ [noRallyData.id]: noRallyDataStats });

  await renderLoadedCard([noRallyData]);

  expect(
    screen.getByText("Not enough rally data logged yet to plot player insights."),
  ).toBeInTheDocument();
});

test("zooms into a crowded plot on tap, and back out again, without growing the avatars", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });
  const user = userEvent.setup({ delay: null });
  await renderLoadedCard();

  const zoomIn = screen.getByRole("button", { name: "Zoom in on player insights" });
  const zoomOut = screen.getByRole("button", { name: "Zoom out on player insights" });
  const link = screen.getByRole("link", { name: "Alex Chen's player insights" });

  expect(zoomOut).toBeDisabled();
  // Base position from the group-scaled test above: left 90%, top 90%.
  expect(link).toHaveStyle({ left: "90%", top: "90%" });

  await user.click(zoomIn);
  // Re-derived at scale 1.5 with no pan yet: 50 + 1.5 * (90 - 50) = 110 —
  // spread further from the plot's own centre, not just magnified in place.
  expect(link).toHaveStyle({ left: "110%", top: "110%" });
  expect(zoomOut).not.toBeDisabled();
  // The whole point of zooming into a cluster is separating avatars that are
  // a fixed size — not growing them proportionally along with the gap
  // between them, which a CSS `transform: scale()` on the plot used to do.
  expect(within(link).getByText("AC")).toHaveClass("size-7");

  await user.click(zoomOut);
  expect(link).toHaveStyle({ left: "90%", top: "90%" });
  expect(zoomOut).toBeDisabled();
});

// No `userEvent` helper expresses a two-finger pinch, so this drives raw
// Pointer Events directly (`fireEvent`) rather than reaching for a real
// accessible interaction that doesn't exist here.
test("pinching off-centre zooms into that spot, not the box's own centre", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });
  await renderLoadedCard();

  const link = screen.getByRole("link", { name: "Alex Chen's player insights" });
  const zoomLayer = link.parentElement!;
  const box = zoomLayer.parentElement!;
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
    right: 200,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => "",
  });

  // Two fingers land either side of (150, 60), a spot in the box's own
  // upper-right, nowhere near its centre at (100, 100) — then spread apart
  // to double the distance between them, pinching in around that same spot.
  fireEvent.pointerDown(box, { pointerId: 1, clientX: 130, clientY: 60 });
  fireEvent.pointerDown(box, { pointerId: 2, clientX: 170, clientY: 60 });
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 110, clientY: 60 });
  fireEvent.pointerMove(box, { pointerId: 2, clientX: 190, clientY: 60 });

  // Scale doubles (80px apart / 40px apart) with a pan of (-50, 40) that
  // keeps (150, 60) fixed under the still-centred-on-(150,60) fingers at
  // that new scale — in a 200×200 box that's -25%/+20% of its own size, on
  // top of Alex Chen's own 90%/90% base position: 50 + 2 * (90 - 50) - 25 =
  // 105 (left), 50 + 2 * (90 - 50) + 20 = 150 (top). Nothing close to a
  // centre-only zoom, which would leave the pan terms at 0.
  expect(link).toHaveStyle({ left: "105%", top: "150%" });
});

test("zooming all the way in disables further zoom-in", async () => {
  stubFetch({
    [shortRally.id]: shortRallyStats,
    [noRallyData.id]: noRallyDataStats,
    [midRally.id]: midRallyStats,
    [longRally.id]: longRallyStats,
  });
  const user = userEvent.setup({ delay: null });
  await renderLoadedCard();

  const zoomIn = screen.getByRole("button", { name: "Zoom in on player insights" });
  await user.click(zoomIn);
  await user.click(zoomIn);
  await user.click(zoomIn);
  await user.click(zoomIn);

  expect(zoomIn).toBeDisabled();
});
