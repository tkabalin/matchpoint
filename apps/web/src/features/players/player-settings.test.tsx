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

import { PlayerSettings } from "./player-settings";

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

async function renderSettings() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings",
    component: PlayerSettings,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const stub = (path: string, heading: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <h1>{heading}</h1>,
    });
  const routeTree = rootRoute.addChildren([
    settingsRoute,
    signInRoute,
    stub("/me/settings/account", "Account & Security"),
    stub("/me/settings/app", "App"),
    stub("/me/settings/support", "Support"),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/me/settings"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Settings" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The point of the redesign: a player's Settings is the coach's drill-down menu,
// so the root holds categories rather than the password form it used to inline.
test("renders a category row per section and no password form", async () => {
  await renderSettings();

  expect(screen.getByRole("link", { name: "Account & Security" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "App" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Support" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
});

// Match Defaults configures how a coach starts a match, so a player has nothing
// to set there — the one category deliberately left off this menu.
test("offers no Match Defaults category", async () => {
  await renderSettings();

  expect(screen.queryByRole("link", { name: "Match Defaults" })).not.toBeInTheDocument();
});

test.each([
  ["Account & Security", "Account & Security"],
  ["App", "App"],
  ["Support", "Support"],
])("the %s row opens its own page", async (rowName, heading) => {
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await user.click(screen.getByRole("link", { name: rowName }));

  expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
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
  await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
  expect(calledLogout).toEqual(["player"]);
});
