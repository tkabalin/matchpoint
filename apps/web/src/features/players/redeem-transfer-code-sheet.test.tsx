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
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { RedeemTransferCodeSheet } from "./redeem-transfer-code-sheet";

const transferredPlayer: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  first_name: "Sipho",
  last_name: "Dlamini",
  username: "dlmsip001",
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

/**
 * The harness above pins `open`, which nothing real does. The roster owns it, so this
 * mirrors that: without a caller that can actually close the sheet, neither Done nor
 * the reset that a dismissal performs can be observed.
 */
function ControlledRedeem() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen redeem
      </button>
      <RedeemTransferCodeSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function renderControlled() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const playersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: ControlledRedeem,
  });
  const playerProfileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <h1>Player Profile</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([playersRoute, playerProfileRoute]),
    history: createMemoryHistory({ initialEntries: ["/players"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Redeem a transfer code" });
}

test("Done dismisses the sheet from the success step, without visiting the player", async () => {
  stubFetch({
    "POST /api/players/redeem-transfer-code": () => Response.json(transferredPlayer),
  });
  const user = userEvent.setup();
  await renderControlled();

  await user.type(screen.getByLabelText("Code"), "GOODCODE");
  await user.click(screen.getByRole("button", { name: "Redeem" }));
  await user.click(await screen.findByRole("button", { name: "Done" }));

  expect(screen.queryByRole("heading", { name: "Player Profile" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
});

// A refusal is about the code that was typed, so it must not outlive it: reopening onto
// the last attempt's error reads as a verdict on a code the coach hasn't entered yet.
test("reopening after a refused code starts from a clean form", async () => {
  stubFetch({
    "POST /api/players/redeem-transfer-code": () =>
      Response.json({ detail: "That code is invalid or has already been used." }, { status: 400 }),
  });
  const user = userEvent.setup();
  await renderControlled();

  await user.type(screen.getByLabelText("Code"), "STALE123");
  await user.click(screen.getByRole("button", { name: "Redeem" }));
  await screen.findByText("That code is invalid or has already been used.");

  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Reopen redeem" }));

  expect(await screen.findByLabelText("Code")).toHaveValue("");
  expect(
    screen.queryByText("That code is invalid or has already been used."),
  ).not.toBeInTheDocument();
});
