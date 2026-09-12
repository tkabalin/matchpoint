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
import { recordOwnerIfUnknown } from "@/lib/local-data";

import { PrimaryMatchAction } from "./primary-match-action";

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-0000000000m1";

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
  localStorage.clear();
  recordOwnerIfUnknown(COACH_ID, "coach");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("offers to start a match with nothing in progress", async () => {
  await renderAction();

  expect(await screen.findByRole("link", { name: "Start a match" })).toBeInTheDocument();
});

test("offers to resume, and resumes into the right player, once a match is under way", async () => {
  await logAMatchInProgress();
  await renderAction();

  const user = userEvent.setup({ delay: null });
  await user.click(await screen.findByRole("link", { name: "Resume match in progress" }));

  expect(await screen.findByRole("heading", { name: "Resume capture" })).toBeInTheDocument();
});

// #251 review: this used to read the coach id off a `/coaches/me` query, dark for
// exactly the coach at the court with no connection this control exists for.
test("offers to resume with no network reachable at all", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("should never be called — offline")));
  await logAMatchInProgress();
  await renderAction();

  expect(await screen.findByRole("link", { name: "Resume match in progress" })).toBeInTheDocument();
});
