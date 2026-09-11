import type { CoachRead } from "@matchpoint/api-client";
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
import { outboxDb } from "@/features/outbox/db";
import { saveMatch } from "@/features/outbox/match-log";

import { PrimaryMatchAction } from "./primary-match-action";

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

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/coaches/me") return Promise.resolve(Response.json(coach));
      throw new Error(`Unstubbed fetch: ${pathname}`);
    }),
  );
}

async function logAMatchInProgress() {
  await saveMatch({
    matchId: MATCH_ID,
    coachId: COACH_ID,
    trackedPlayerId: PLAYER_ID,
    nextSequence: 0,
    finished: false,
    updatedAt: Date.now(),
    payload: Match.create({
      matchId: MATCH_ID,
      playedOn: "2026-08-23",
      trackedPlayerId: PLAYER_ID,
      opponentId: OPPONENT_ID,
      opponentName: null,
      scoringSystem: "traditional",
      firstServer: PLAYER_ID,
      surfaceType: "hard",
      outcomeOverride: null,
    }).toJSON(),
  });
}

async function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches",
    component: PrimaryMatchAction,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match",
    component: () => <h1>Start a match</h1>,
  });
  const resumeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match/$playerId",
    component: () => <h1>Resume capture</h1>,
  });
  const routeTree = rootRoute.addChildren([matchesRoute, newMatchRoute, resumeRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/matches"] }),
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

test("offers to start a match with nothing in progress", async () => {
  stubFetch();
  await renderAction();

  expect(await screen.findByRole("link", { name: "Start a match" })).toBeInTheDocument();
});

test("offers to resume, and resumes into the right player, once a match is under way", async () => {
  stubFetch();
  await logAMatchInProgress();
  await renderAction();

  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("link", { name: "Resume match in progress" }));

  expect(await screen.findByRole("heading", { name: "Resume capture" })).toBeInTheDocument();
});
