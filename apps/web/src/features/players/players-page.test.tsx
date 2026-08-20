import type { PlayerRead } from "@matchpoint/api-client";
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
import { afterEach, expect, test, vi } from "vitest";

import { getLastViewedPlayerId } from "@/lib/last-viewed-player";

import { PlayersPage } from "./players-page";

// Annotated rather than inferred so tsc holds the fixture to the generated contract.
const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
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

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders PlayersPage inside a real (in-memory) router — its bottom nav needs
 * router context regardless of what the roster itself renders. */
async function renderPlayersPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: PlayersPage,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const matchesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/matches",
    component: () => <h1>Matches</h1>,
  });
  const statsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stats",
    component: () => <h1>Stats</h1>,
  });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const newMatchRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/new-match/$playerId",
    component: () => <h1>New Match</h1>,
  });
  const routeTree = rootRoute.addChildren([
    playersRoute,
    homeRoute,
    matchesRoute,
    statsRoute,
    profileRoute,
    newMatchRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Players" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("renders the page heading and the roster", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayersPage();

  expect(await screen.findByText("No players yet")).toBeInTheDocument();
});

test("tapping a player offers viewing them or starting a match", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(await screen.findByRole("button", { name: /Amahle Nkosi/ }));

  expect(await screen.findByRole("link", { name: "View player" })).toHaveAttribute(
    "href",
    `/players/${player.id}`,
  );
  expect(screen.getByRole("link", { name: "Start match" })).toHaveAttribute(
    "href",
    `/new-match/${player.id}`,
  );
});

test("choosing View player opens the profile and records them as last-viewed", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(await screen.findByRole("button", { name: /Amahle Nkosi/ }));
  await user.click(await screen.findByRole("link", { name: "View player" }));

  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
  expect(getLastViewedPlayerId()).toBe(player.id);
});

test("filters the roster as the coach searches", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup();
  await renderPlayersPage();

  await screen.findByText("Amahle Nkosi");
  await user.type(screen.getByRole("textbox", { name: "Search players" }), "zzz");

  expect(await screen.findByText("No players found")).toBeInTheDocument();
});

test("renders the bottom nav with Players active", async () => {
  stubFetch(() => Response.json([]));

  await renderPlayersPage();

  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matches" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Players" })).toHaveAttribute("aria-current", "page");
});

test("the header button opens the redeem-transfer-code sheet", async () => {
  stubFetch(() => Response.json([]));
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(screen.getByRole("button", { name: "Redeem transfer code" }));

  expect(
    await screen.findByRole("heading", { name: "Redeem a transfer code" }),
  ).toBeInTheDocument();
});

test("the floating action adds a player rather than starting a match", async () => {
  stubFetch(() => Response.json([player]));
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(screen.getByRole("button", { name: "Add player" }));

  // The floating action drops out of the tree while the sheet is open — Base UI
  // marks the background inert — so this "Add player" is the form's submit.
  expect(await screen.findByRole("heading", { name: "Add a player" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add player" })).toHaveAttribute("type", "submit");
});

/** Fills every required field with a valid value. */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("textbox", { name: "First name" }), "Nomsa");
  await user.type(screen.getByRole("textbox", { name: "Last name" }), "Khumalo");
  await user.type(screen.getByLabelText("Date of birth"), "2008-04-12");
  await user.click(screen.getByRole("button", { name: "Female" }));
}

test("submitting the add-player form posts every required field", async () => {
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      if (input.method === "POST") {
        posted.push(input.url);
        return input.text().then((body) => {
          posted.push(body);
          return Response.json({ ...player, first_name: "Nomsa", last_name: "Khumalo" });
        });
      }
      return Promise.resolve(Response.json([player]));
    }),
  );
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(screen.getByRole("button", { name: "Add player" }));
  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: /^Add player$/ }));

  await waitFor(() => expect(posted.some((entry) => entry.includes("/api/players"))).toBe(true));
  const body = posted.join(" ");
  expect(body).toContain('"first_name":"Nomsa"');
  expect(body).toContain('"date_of_birth":"2008-04-12"');
  expect(body).toContain('"gender":"female"');
  expect(body).toContain('"dominant_hand":"right"');
});

// Player setup happens ahead of time, not courtside, so the full record is asked
// for rather than just the name (#77).
test("refuses to submit until date of birth and gender are given", async () => {
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      if (input.method === "POST") posted.push(input.url);
      return Promise.resolve(Response.json([player]));
    }),
  );
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(screen.getByRole("button", { name: "Add player" }));
  await user.type(await screen.findByRole("textbox", { name: "First name" }), "Nomsa");
  await user.type(screen.getByRole("textbox", { name: "Last name" }), "Khumalo");
  await user.click(screen.getByRole("button", { name: /^Add player$/ }));

  expect(await screen.findByText("Date of birth is required.")).toBeInTheDocument();
  expect(screen.getByText("Gender is required.")).toBeInTheDocument();
  expect(posted).toEqual([]);
});

// The API rejects both bounds but JSON Schema can express neither, so without this
// check the coach just meets a 422.
test("rejects a date of birth in the future before sending it", async () => {
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      if (input.method === "POST") posted.push(input.url);
      return Promise.resolve(Response.json([player]));
    }),
  );
  const user = userEvent.setup();
  await renderPlayersPage();

  await user.click(screen.getByRole("button", { name: "Add player" }));
  await user.type(await screen.findByRole("textbox", { name: "First name" }), "Nomsa");
  await user.type(screen.getByRole("textbox", { name: "Last name" }), "Khumalo");
  await user.type(screen.getByLabelText("Date of birth"), "2999-01-01");
  await user.click(screen.getByRole("button", { name: "Other" }));
  await user.click(screen.getByRole("button", { name: /^Add player$/ }));

  expect(await screen.findByText("Date of birth cannot be in the future.")).toBeInTheDocument();
  expect(posted).toEqual([]);
});
