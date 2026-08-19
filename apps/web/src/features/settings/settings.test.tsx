import type { CoachRead } from "@matchpoint/api-client";
import { getCurrentCoachQueryKey } from "@matchpoint/api-client/react-query";
import { zChangePasswordBody } from "@matchpoint/api-client/zod";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { queryPersistOptions } from "@/lib/query-persist";

import { Settings } from "./settings";

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "coach@example.com",
  display_name: "Amahle Nkosi",
  default_surface: null,
  default_scoring_system: null,
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

async function fillChangePasswordForm(
  user: ReturnType<typeof userEvent.setup>,
  { current = "old-password", next = "granite-otter-42-quiz" } = {},
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), next);
}

/** Renders Settings inside a real (in-memory) router and its own QueryClient, seeded
 * with a dummy cached query so a test can prove sign-out actually clears it — the
 * next coach on this device would otherwise see the previous coach's roster. */
async function renderSettings() {
  // staleTime: Infinity so seeding the coach query below actually prevents a fetch —
  // useQuery still background-refetches stale data on mount by default (staleTime: 0),
  // unlike ensureQueryData's cache-first check. This test file's single-handler
  // stubFetch (or no stub at all) shouldn't also have to answer /api/coaches/me.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["players"], [{ id: "1", first_name: "Amahle" }]);
  queryClient.setQueryData(getCurrentCoachQueryKey(), coach);

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: Settings,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/install",
    component: () => <h1>Install MatchPoint</h1>,
  });
  const routeTree = rootRoute.addChildren([settingsRoute, signInRoute, installRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Settings" });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("links to the install guide", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("link", { name: "Install MatchPoint on your phone" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});

test("opens a confirmation dialog when Sign Out is clicked", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("Sign out?")).toBeInTheDocument();
});

test("Cancel closes the dialog without signing out", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  await screen.findByText("Sign out?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Sign out?")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test("confirming signs out, clears the query cache, and shows a success dialog", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  // The IndexedDB copy of the cache outlives the tab, so clearing memory alone would
  // still leave this coach's roster on a device the next coach signs in on.
  await queryPersistOptions.persister.persistClient({
    buster: queryPersistOptions.buster,
    timestamp: Date.now(),
    clientState: { mutations: [], queries: [] },
  });
  const user = userEvent.setup();
  const queryClient = await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  // Two "Sign Out" buttons exist once the dialog is open: the page's own trigger and
  // the dialog's confirm action — scope to the dialog for the one that matters here.
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("You've been signed out.")).toBeInTheDocument();
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
    coachId: coach.id,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));
  await screen.findByText("You've been signed out.");

  // The one path on which unsynced points go: a coach who signs out has said this
  // device is no longer theirs, and a queue left behind is a queue the next coach
  // on it inherits (#117). A revoked session takes the other branch and keeps them.
  expect(await readPending(coach.id)).toHaveLength(0);
});

test("says so when the device could not be cleared", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  // What a browser with storage blocked does. The session is gone by then, so the
  // dialog has to finish either way, and finishing silently would claim a clean device.
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(
    await screen.findByText("Some of your data could not be cleared from this device."),
  ).toBeInTheDocument();
});

test("retrying a failed purge clears the failure message once storage recovers", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));
  await screen.findByText("Some of your data could not be cleared from this device.");

  removeItem.mockRestore();
  await user.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => {
    expect(
      screen.queryByText("Some of your data could not be cleared from this device."),
    ).not.toBeInTheDocument();
  });
});

test("a second failed retry leaves the failure dialog exactly as it was", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));
  await screen.findByText("Some of your data could not be cleared from this device.");

  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(
    await screen.findByText("Some of your data could not be cleared from this device."),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "You've been signed out." }),
  ).toBeInTheDocument();
});

test("acknowledging the success dialog navigates to sign in", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup();
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const confirmDialog = await screen.findByRole("alertdialog");
  await user.click(within(confirmDialog).getByRole("button", { name: "Sign Out" }));
  await screen.findByText("You've been signed out.");

  await user.click(screen.getByRole("button", { name: "OK" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("changing the password shows a success message and clears the form", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup();
  await renderSettings();

  await fillChangePasswordForm(user);
  await user.click(screen.getByRole("button", { name: "Change Password" }));

  expect(await screen.findByText("Your password has been changed.")).toBeInTheDocument();
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByLabelText("New password")).toHaveValue("");
});

test("submits a body the API's own schema accepts", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup();
  await renderSettings();

  await fillChangePasswordForm(user, { current: "old-password", next: "new-password-123" });
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  await screen.findByText("Your password has been changed.");

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  const body: unknown = await (request as Request).json();
  expect(zChangePasswordBody.safeParse(body).success).toBe(true);
});

test("shows an inline error on the current-password field when it's wrong", async () => {
  stubFetch(() => Response.json({ detail: "Incorrect password" }, { status: 403 }));
  const user = userEvent.setup();
  await renderSettings();

  await fillChangePasswordForm(user);
  await user.click(screen.getByRole("button", { name: "Change Password" }));

  expect(await screen.findByText("Incorrect password.")).toBeInTheDocument();
});

test("shows a session-expired fallback with a sign-in link on a 401", async () => {
  stubFetch(() => Response.json({ detail: "Not signed in" }, { status: 401 }));
  const user = userEvent.setup();
  await renderSettings();

  await fillChangePasswordForm(user);
  await user.click(screen.getByRole("button", { name: "Change Password" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired.");
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/");
});

test("flags mismatched new passwords before submitting", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.type(screen.getByLabelText("Current password"), "old-password");
  await user.type(screen.getByLabelText("New password"), "new-password-123");
  await user.type(screen.getByLabelText("Confirm new password"), "something-else");

  expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change Password" })).toBeDisabled();
});

test("flags a new password shorter than the API's minimum", async () => {
  const user = userEvent.setup();
  await renderSettings();

  await user.type(screen.getByLabelText("New password"), "short");

  expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change Password" })).toBeDisabled();
});
