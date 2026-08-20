import type { PlayerRead } from "@matchpoint/api-client";
import { zRedeemPlayerTransferCodeBody } from "@matchpoint/api-client/zod";
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
import { afterEach, expect, test, vi } from "vitest";

import { RedeemTransferCodeSheet } from "./redeem-transfer-code-sheet";

const transferredPlayer: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  first_name: "Sipho",
  last_name: "Dlamini",
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

function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const key = `${input.method} ${pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`Unstubbed fetch: ${key}`);
      return Promise.resolve(handler(input));
    }),
  );
}

async function renderSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: () => <RedeemTransferCodeSheet open onOpenChange={() => {}} />,
  });
  const playerProfileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const routeTree = rootRoute.addChildren([playersRoute, playerProfileRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Redeem a transfer code" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("redeeming a valid code shows the transferred player and links to their profile", async () => {
  const posted: unknown[] = [];
  stubFetch({
    "POST /api/players/redeem-transfer-code": async (input) => {
      posted.push(JSON.parse(await input.text()));
      return Response.json(transferredPlayer);
    },
  });
  const user = userEvent.setup();
  await renderSheet();

  await user.type(screen.getByLabelText("Code"), "ABCD1234");
  await user.click(screen.getByRole("button", { name: "Redeem" }));

  expect(
    await screen.findByRole("heading", { name: "Sipho added to your roster" }),
  ).toBeInTheDocument();
  expect(zRedeemPlayerTransferCodeBody.safeParse(posted[0]).success).toBe(true);
  expect(posted[0]).toEqual({ code: "ABCD1234" });

  await user.click(screen.getByRole("link", { name: "View player" }));
  expect(await screen.findByRole("heading", { name: "Player Profile" })).toBeInTheDocument();
});

test("shows the server's message when the code is unknown or already used", async () => {
  stubFetch({
    "POST /api/players/redeem-transfer-code": () =>
      Response.json({ detail: "That code is invalid or has already been used." }, { status: 400 }),
  });
  const user = userEvent.setup();
  await renderSheet();

  await user.type(screen.getByLabelText("Code"), "STALE123");
  await user.click(screen.getByRole("button", { name: "Redeem" }));

  expect(
    await screen.findByText("That code is invalid or has already been used."),
  ).toBeInTheDocument();
});

test("shows the server's message when the player is already on this coach's roster", async () => {
  stubFetch({
    "POST /api/players/redeem-transfer-code": () =>
      Response.json({ detail: "That player is already on your roster." }, { status: 409 }),
  });
  const user = userEvent.setup();
  await renderSheet();

  await user.type(screen.getByLabelText("Code"), "SELF1234");
  await user.click(screen.getByRole("button", { name: "Redeem" }));

  expect(await screen.findByText("That player is already on your roster.")).toBeInTheDocument();
});

test("a 429 shows a retry countdown", async () => {
  stubFetch({
    "POST /api/players/redeem-transfer-code": () =>
      new Response(JSON.stringify({ detail: "Too many attempts." }), {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
  });
  const user = userEvent.setup();
  await renderSheet();

  await user.type(screen.getByLabelText("Code"), "ABCD1234");
  await user.click(screen.getByRole("button", { name: "Redeem" }));

  expect(await screen.findByText(/Try again in 30s\./)).toBeInTheDocument();
});
