import type { PlayerRead } from "@matchpoint/api-client";
import { listPlayersQueryKey } from "@matchpoint/api-client/react-query";
import { zDeleteCurrentCoachBody } from "@matchpoint/api-client/zod";
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

import { queryPersistOptions } from "@/lib/query-persist";

import { DeleteAccountSheet } from "./delete-account-sheet";

const player: PlayerRead = {
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

async function renderSheet({
  players = [] as PlayerRead[],
  onOpenChange = () => {},
}: { players?: PlayerRead[]; onOpenChange?: (open: boolean) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(listPlayersQueryKey(), players);

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/account",
    component: () => <DeleteAccountSheet open onOpenChange={onOpenChange} />,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([settingsRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/account"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Deleting your account also deletes your players" });
  return queryClient;
}

async function goToFinalWarn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Confirm your password" });
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Delete your account?" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("names an outstanding transfer code on the first warning", async () => {
  await renderSheet({ players: [{ ...player, has_transfer_code: true }] });

  expect(await screen.findByText(/Sipho has an outstanding transfer code\./)).toBeInTheDocument();
});

test("says nothing about transfer codes when the roster has none outstanding", async () => {
  await renderSheet({ players: [player] });

  expect(screen.queryByText(/outstanding transfer code/)).not.toBeInTheDocument();
});

test("Cancel on the first step closes the sheet", async () => {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = vi.fn();
  await renderSheet({ onOpenChange });

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("Back on the password step returns to the roster warning", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await user.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Confirm your password" });
  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(
    await screen.findByRole("heading", { name: "Deleting your account also deletes your players" }),
  ).toBeInTheDocument();
});

test("the full happy path deletes with delete_players true, purges local data, and navigates home", async () => {
  const deletes: string[] = [];
  stubFetch({
    "DELETE /api/coaches/me": async (input) => {
      deletes.push(await input.text());
      return new Response(null, { status: 204 });
    },
  });
  await queryPersistOptions.persister.persistClient({
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: { mutations: [], queries: [] },
  });
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await goToFinalWarn(user);
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(await screen.findByText("Your account has been deleted.")).toBeInTheDocument();
  expect(deletes).toHaveLength(1);
  const body = JSON.parse(deletes[0]!) as unknown;
  expect(body).toEqual({ password: "hunter2", delete_players: true });
  expect(zDeleteCurrentCoachBody.safeParse(body).success).toBe(true);
  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();

  await user.click(screen.getByRole("button", { name: "OK" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("a wrong password returns to the password step with the error shown there", async () => {
  stubFetch({
    "DELETE /api/coaches/me": () =>
      Response.json({ detail: "Incorrect password" }, { status: 403 }),
  });
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await goToFinalWarn(user);
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(await screen.findByRole("heading", { name: "Confirm your password" })).toBeInTheDocument();
  expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
});

test("an outstanding transfer code shows its own message on the final step", async () => {
  stubFetch({
    "DELETE /api/coaches/me": () =>
      Response.json(
        { detail: "Outstanding transfer codes must be cancelled or redeemed first" },
        { status: 409 },
      ),
  });
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await goToFinalWarn(user);
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(
    await screen.findByText("Outstanding transfer codes must be cancelled or redeemed first"),
  ).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Delete your account?" })).toBeInTheDocument();
});

test("a 429 shows a retry countdown and disables the delete button", async () => {
  stubFetch({
    "DELETE /api/coaches/me": () =>
      Response.json(
        { detail: "Too many attempts." },
        { status: 429, headers: { "Retry-After": "30" } },
      ),
  });
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await goToFinalWarn(user);
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(await screen.findByText(/Try again in 30s\./)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete account" })).toBeDisabled();
});

test("says so when the device could not be cleared, and Retry clears the message once storage recovers", async () => {
  stubFetch({ "DELETE /api/coaches/me": () => new Response(null, { status: 204 }) });
  const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  const user = userEvent.setup({ delay: null });
  await renderSheet();

  await goToFinalWarn(user);
  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(
    await screen.findByText("Some of your data could not be cleared from this device."),
  ).toBeInTheDocument();

  removeItem.mockRestore();
  await user.click(screen.getByRole("button", { name: "Retry clearing this device" }));

  await waitFor(() => {
    expect(
      screen.queryByText("Some of your data could not be cleared from this device."),
    ).not.toBeInTheDocument();
  });
});
