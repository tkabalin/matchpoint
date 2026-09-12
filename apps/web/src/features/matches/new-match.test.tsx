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
import { afterEach, expect, test, vi } from "vitest";

import { recordOwnerIfUnknown } from "@/lib/local-data";

import { NewMatch } from "./new-match";

// Capture appends to IndexedDB, which jsdom has none of; the flow itself is covered by
// live-match.test.tsx.
vi.mock("@/features/outbox/outbox", () => ({ append: vi.fn(() => new Promise(() => {})) }));

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
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      if (pathname === "/api/coaches/me") return coachResponse();
      return Promise.resolve(playerResponse());
    }),
  );
}

// The owner record stands in for a sign-in having happened on this device, which is
// where capture gets the coach it queues under.
function renderNewMatch({ owner = coach.id }: { owner?: string | null } = {}) {
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
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([newMatchRoute, homeRoute]),
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
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
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

// Reachable by typing a url, or from a stale link after the player was deleted.
// Before #78 this rendered the form headed "New match" with no name, offering to
// start a match for a player the coach cannot see.
test("says not found instead of an unnamed form when the player isn't the coach's", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "Player not found" }), { status: 404 }));
  renderNewMatch();

  expect(await screen.findByText("Player not found")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start match" })).not.toBeInTheDocument();
});
