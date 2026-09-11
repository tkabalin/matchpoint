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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Match } from "@/features/capture/match";
import { Point } from "@/features/capture/point";
import { outboxDb } from "@/features/outbox/db";
import { appendEvent, saveMatch } from "@/features/outbox/match-log";

import { InProgressBanner } from "./in-progress-banner";

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-0000000000m1";

const coach: CoachRead = {
  id: COACH_ID,
  email: "coach@example.com",
  display_name: "Danny",
  default_surface: null,
  default_scoring_system: null,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const player: PlayerRead = {
  id: PLAYER_ID,
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: COACH_ID,
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn().mockImplementation((input: Request) => {
    const { pathname } = new URL(input.url);
    const handler = routes[pathname];
    if (!handler) throw new Error(`Unstubbed fetch: ${pathname}`);
    return Promise.resolve(handler());
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubAuthenticated() {
  return stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    [`/api/players/${PLAYER_ID}`]: () => Response.json(player),
  });
}

function makeMatch() {
  return Match.create({
    matchId: MATCH_ID,
    playedOn: "2026-08-23",
    trackedPlayerId: PLAYER_ID,
    opponentId: OPPONENT_ID,
    opponentName: null,
    scoringSystem: "traditional",
    firstServer: PLAYER_ID,
    surfaceType: "hard",
    outcomeOverride: null,
  });
}

/** Logs a match with one won point, the way `queueEvent` in `live-match.tsx` writes
 *  both rows on a real commit — the banner reads the outbox, not the API. */
async function logAMatchInProgress(updatedAt = Date.now()) {
  await saveMatch({
    matchId: MATCH_ID,
    coachId: COACH_ID,
    trackedPlayerId: PLAYER_ID,
    nextSequence: 1,
    finished: false,
    updatedAt,
    payload: makeMatch().toJSON(),
  });
  await appendEvent({
    id: "point-0",
    matchId: MATCH_ID,
    coachId: COACH_ID,
    sequence: 0,
    kind: "point",
    payload: Point.create({
      id: "point-0",
      matchId: MATCH_ID,
      timestamp: Date.now(),
      sequence: 0,
      server: "TRACKED",
      courtSide: "DEUCE",
      won: true,
      context: {
        setNumber: 1,
        gameNumber: 1,
        inTiebreak: false,
        isBreakPoint: false,
        isGamePoint: false,
        isGameEnd: false,
        isSetPoint: false,
        isSetEnd: false,
        isMatchPoint: false,
      },
      serves: [],
      returnOutcome: null,
      endReason: null,
      unusualReason: null,
      unusualNote: null,
      note: null,
      wing: null,
      shotType: null,
      ballIn: null,
      ballLocation: null,
      rallyLengthBucket: null,
    }).toJSON(),
  });
}

async function renderBanner() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: InProgressBanner,
  });
  const resumeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match/$playerId",
    component: () => <h1>Resume capture</h1>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, resumeRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await outboxDb.events.clear();
  await outboxDb.matches.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders nothing with no match logged", async () => {
  const fetchMock = stubAuthenticated();
  await renderBanner();

  // Nothing to find a heading or link on: wait for the coach query the banner
  // itself depends on to resolve, then confirm it still hasn't drawn anything.
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("shows the player's name, a live score and links to resume capture", async () => {
  stubAuthenticated();
  await logAMatchInProgress(Date.now() - 60_000);
  await renderBanner();

  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
  expect(screen.getByText(/0-0, 15-0/)).toBeInTheDocument();
  expect(screen.getByText(/1m ago/)).toBeInTheDocument();

  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole("link"));

  expect(await screen.findByRole("heading", { name: "Resume capture" })).toBeInTheDocument();
});

test("falls back to a generic title when the player can't be read", async () => {
  stubFetch({
    "/api/coaches/me": () => Response.json(coach),
    [`/api/players/${PLAYER_ID}`]: () => new Response(null, { status: 404 }),
  });
  await logAMatchInProgress();
  await renderBanner();

  expect(await screen.findByText("Match in progress")).toBeInTheDocument();
});
