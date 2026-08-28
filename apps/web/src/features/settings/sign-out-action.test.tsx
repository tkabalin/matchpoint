import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { queryPersistOptions } from "@/lib/query-persist";

import { SignOutAction } from "./sign-out-action";

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders SignOutAction with a plain "Sign Out" trigger, inside a real router and
 * its own QueryClient, seeded with a dummy cached query so a test can prove sign-out
 * actually clears it — the next coach on this device would otherwise see the
 * previous coach's roster. */
async function renderSignOutAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["players"], [{ id: "1", first_name: "Amahle" }]);

  // Toaster lives at the root, same as root-layout.tsx's real composition —
  // mounting it inside the settings route would unmount it (and any toast it's
  // showing) the moment sign-out navigates away.
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Toaster />
      </>
    ),
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => (
      <SignOutAction
        trigger={(openConfirm) => (
          <button type="button" onClick={openConfirm}>
            Sign Out
          </button>
        )}
      />
    ),
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([settingsRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Sign Out" });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("opens a confirmation dialog when clicked", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSignOutAction();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("Sign out?")).toBeInTheDocument();
});

test("Cancel closes the dialog without signing out", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup({ delay: null });
  await renderSignOutAction();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  await screen.findByText("Sign out?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Sign out?")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("confirming signs out, clears the query cache, and navigates to sign-in directly", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  // The IndexedDB copy of the cache outlives the tab, so clearing memory alone would
  // still leave this coach's roster on a device the next coach signs in on.
  await queryPersistOptions.persister.persistClient({
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: { mutations: [], queries: [] },
  });
  const user = userEvent.setup({ delay: null });
  const queryClient = await renderSignOutAction();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  // No second dialog to dismiss — confirming takes the coach straight to sign-in.
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  expect(queryClient.getQueryData(["players"])).toBeUndefined();
  expect(await queryPersistOptions.persister.restoreClient()).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("confirming also deletes the points that never synced", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  await outboxDb.delete();
  await outboxDb.open();
  await append({
    id: "3f1c2b4e-0000-4000-8000-0000000000a1",
    coachId: COACH_ID,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
  const user = userEvent.setup({ delay: null });
  await renderSignOutAction();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));
  await screen.findByRole("heading", { name: "Sign In" });

  // The one path on which unsynced points go: a coach who signs out has said this
  // device is no longer theirs, and a queue left behind is a queue the next coach
  // on it inherits (#117). A revoked session takes the other branch and keeps them.
  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("says so with a toast when the device could not be cleared, but still signs out", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  // What a browser with storage blocked does. The session is gone by then, so
  // sign-out has to finish either way, rather than claim a clean device.
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  const user = userEvent.setup({ delay: null });
  await renderSignOutAction();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(
    await screen.findByText("Some of your data could not be cleared from this device."),
  ).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});
