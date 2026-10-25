import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerSettingsAccount } from "./player-settings-account";

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

async function renderAccount() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings/account",
    component: PlayerSettingsAccount,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings",
    component: () => <h1>Settings</h1>,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([accountRoute, settingsRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me/settings/account"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Account & Security" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The point of #300: this page is a row that opens a form, not the form
// itself sitting open on the page by default — see change-password-sheet.test.tsx
// for the form's own behaviour.
test("renders a Change password row, not an open password form", async () => {
  await renderAccount();

  expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
});

test("the Change password row opens the sheet", async () => {
  const user = userEvent.setup({ delay: null });
  await renderAccount();

  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByLabelText("Current password")).toBeInTheDocument();
});

// Both are coach-only server-side: DELETE /auth/sessions takes a coach, and
// deleting a player is the coach's action on their own roster.
test("offers neither revoke-everywhere nor delete-account", async () => {
  await renderAccount();

  expect(
    screen.queryByRole("button", { name: "Sign out of all other sessions" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
});

test("goes back to the settings menu", async () => {
  const user = userEvent.setup({ delay: null });
  await renderAccount();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("signs out through playerLogout, then lands on sign-in", async () => {
  const calledLogout: string[] = [];
  stubFetch({
    "POST /api/auth/player/logout": () => {
      calledLogout.push("player");
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup({ delay: null });
  await renderAccount();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  expect(calledLogout).toEqual(["player"]);
});
