import type { CoachRead, PlayerRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { saveMatch } from "@/features/outbox/match-log";
import { recordOwnerIfUnknown } from "@/lib/local-data";

import { NewMatch } from "./new-match";

// Only `append` is stubbed, never resolving: capture fires it and moves on, so
// nothing here needs it to land, and the flow itself is covered by
// live-match.test.tsx. Everything else stays real — the claim tests below (#197)
// read and write the same outbox tables `LiveMatch` and `NewMatch` do.
vi.mock("@/features/outbox/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/outbox/outbox")>();
  return { ...actual, append: vi.fn(() => new Promise(() => {})) };
});

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "jamie@example.com",
  display_name: "Jamie Chen",
  default_surface: null,
  default_scoring_system: null,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

function stubFetch(
  playerResponse: () => Response = () => Response.json(player),
  coachResponse: () => Promise<Response> = () => Promise.resolve(Response.json(coach)),
  opponentsResponse: () => Promise<Response> = () => Promise.resolve(Response.json([])),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/coaches/me") return coachResponse();
      if (pathname.endsWith("/analytics/opponents")) return opponentsResponse();
      return Promise.resolve(playerResponse());
    }),
  );
}

// The owner record stands in for a sign-in having happened on this device, which is
// where capture gets the coach it queues under.
function renderNewMatch({
  owner = coach.id,
  withMatchRoute = false,
}: { owner?: string | null; withMatchRoute?: boolean } = {}) {
  if (owner !== null) recordOwnerIfUnknown(owner, "coach");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "/_authenticated",
    component: () => <Outlet />,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/new-match/$playerId",
    component: NewMatch,
  });
  const homeRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  // Only added where a test navigates there, so "View results" has somewhere real
  // to land — omitted routes are the default coverage against a stray `navigate`.
  const matchRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: "/matches/$matchId",
    component: () => <h1>Match results</h1>,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren(
      withMatchRoute ? [newMatchRoute, homeRoute, matchRoute] : [newMatchRoute, homeRoute],
    ),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/new-match/${player.id}`] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(async () => {
  await outboxDb.matches.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/**
 * Player/coach/opponents served the same way `stubFetch` above does, plus the
 * claim-related routes a #197 test cares about — kept separate rather than adding
 * more optional params to `stubFetch`, since only these tests touch capture at all.
 */
function stubClaimFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/coaches/me") return Promise.resolve(Response.json(coach));
      if (pathname.endsWith("/analytics/opponents")) return Promise.resolve(Response.json([]));
      if (pathname === `/api/players/${player.id}`) return Promise.resolve(Response.json(player));
      const handler = routes[pathname];
      if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
      return Promise.resolve(handler(input));
    }),
  );
}

// Reachable once capture has queued a match row for this player and this device
// has come back to it — `restoreInProgress`'s own payload never matters for these,
// since a conflict/finished/gone outcome is decided before `LiveMatch` renders (or,
// for a conflict, decided independently of whatever it does with the payload).
function seedInProgressMatch() {
  return saveMatch({
    matchId: "3f1c2b4e-0000-4000-8000-000000000099",
    coachId: coach.id,
    trackedPlayerId: player.id,
    nextSequence: 1,
    finished: false,
    updatedAt: Date.now(),
    payload: {},
  });
}

test("shows the takeover prompt when another device holds the claim", async () => {
  await seedInProgressMatch();
  stubClaimFetch({
    "/api/matches/3f1c2b4e-0000-4000-8000-000000000099/capture": () =>
      Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
    "/api/matches/3f1c2b4e-0000-4000-8000-000000000099": () =>
      Response.json({ id: "3f1c2b4e-0000-4000-8000-000000000099", result: null }),
  });

  renderNewMatch();

  expect(
    await screen.findByRole("heading", { name: "Being captured on another device" }),
  ).toBeInTheDocument();
});

test("offers to view results when the match already finished elsewhere", async () => {
  await seedInProgressMatch();
  stubClaimFetch({
    "/api/matches/3f1c2b4e-0000-4000-8000-000000000099/capture": () =>
      Response.json({ detail: "Match is being captured on another device" }, { status: 409 }),
    "/api/matches/3f1c2b4e-0000-4000-8000-000000000099": () =>
      Response.json({ id: "3f1c2b4e-0000-4000-8000-000000000099", result: "win" }),
  });
  const user = userEvent.setup();

  const router = renderNewMatch({ withMatchRoute: true });

  await screen.findByText("This match is already finished");
  await user.click(screen.getByRole("button", { name: "View results" }));

  await waitFor(() =>
    expect(router.state.location.pathname).toBe("/matches/3f1c2b4e-0000-4000-8000-000000000099"),
  );
});

test("stops capture and never renders it once the match is deleted elsewhere", async () => {
  await seedInProgressMatch();
  stubClaimFetch({
    "/api/matches/3f1c2b4e-0000-4000-8000-000000000099/capture": () =>
      Response.json({ detail: "Match not found" }, { status: 404 }),
  });

  renderNewMatch();

  expect(await screen.findByText("This match was deleted")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Match" })).not.toBeInTheDocument();
});

test("hands the player and coach to capture, and starts at setup", async () => {
  stubFetch();
  renderNewMatch();

  expect(await screen.findByRole("heading", { name: "Match" })).toBeInTheDocument();
  expect(screen.getByText("Amahle")).toBeInTheDocument();
  expect(screen.getByLabelText("Opponent")).toBeInTheDocument();
});

// The court is where the connection isn't, and a version bump discards the persisted
// query cache — so /coaches/me can be unreachable with nothing cached behind it. It
// carries the setup defaults and nothing else, and capture must still start.
test("starts a match with the coach unreachable", async () => {
  stubFetch(undefined, () => Promise.reject(new Error("offline")));
  renderNewMatch();

  expect(await screen.findByRole("heading", { name: "Match" })).toBeInTheDocument();
  expect(screen.getByLabelText("Opponent")).toBeInTheDocument();
});

test("opens the form on the defaults the coach saved", async () => {
  stubFetch(undefined, () =>
    Promise.resolve(
      Response.json({ ...coach, default_scoring_system: "short_sets", default_surface: "grass" }),
    ),
  );
  renderNewMatch();

  expect(await screen.findByLabelText("Scoring system")).toHaveTextContent("Short Sets");
  expect(screen.getByLabelText("Court type")).toHaveTextContent("Grass");
});

// Nothing recorded the device's owner, so a queued match would name a coach the sync
// layer never drains for.
test("says so instead of starting a match no drain can send", async () => {
  stubFetch();
  renderNewMatch({ owner: null });

  expect(await screen.findByText(/no coach recorded yet/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
});

test("offers this player's previous opponents as suggestions", async () => {
  stubFetch(undefined, undefined, () =>
    Promise.resolve(Response.json([{ key: "okoye", name: "Okoye", matches: 3 }])),
  );
  renderNewMatch();

  await screen.findByRole("heading", { name: "Match" });
  await userEvent.setup().click(screen.getByLabelText("Opponent"));

  expect(screen.getByRole("option", { name: "Okoye" })).toBeInTheDocument();
});

// The court is where the connection isn't — the suggestions list has to be able to
// come back empty (never fetched, or the request failed) without blocking setup.
test("starts a match with no previous-opponent suggestions available", async () => {
  stubFetch(undefined, undefined, () => Promise.reject(new Error("offline")));
  renderNewMatch();

  expect(await screen.findByRole("heading", { name: "Match" })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByLabelText("Opponent"));

  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

// Reachable by typing a url, or from a stale link after the player was deleted.
// Before #78 this rendered the form headed "New match" with no name, offering to
// start a match for a player the coach cannot see.
test("says not found instead of an unnamed form when the player isn't the coach's", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 }));
  renderNewMatch();

  expect(await screen.findByText("Player not found")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
});
