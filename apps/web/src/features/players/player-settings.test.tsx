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
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/install",
    component: () => <h1>Install MatchPoint</h1>,
  });
  const routeTree = rootRoute.addChildren([settingsRoute, signInRoute, installRoute]);
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

async function fillPasswordFields(
  user: ReturnType<typeof userEvent.setup>,
  current = "onetimepass",
  next = "correct-horse-battery-staple",
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), next);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the change-password fields and the sign-out action", async () => {
  await renderSettings();

  expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
});

// #275: a player had no reachable path to the install guide before this row existed.
test("links to the player's own install guide route", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await user.click(screen.getByRole("link", { name: "Install MatchPoint" }));

  expect(await screen.findByRole("heading", { name: "Install MatchPoint" })).toBeInTheDocument();
});

test("blocks submit until the new password and its confirmation match", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  const submit = screen.getByRole("button", { name: "Change password" });
  expect(submit).toBeDisabled();

  await fillPasswordFields(user);
  expect(submit).toBeEnabled();
});

test("shows a mismatch error and blocks submit when the confirmation differs", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await user.type(screen.getByLabelText("Current password"), "onetimepass");
  await user.type(screen.getByLabelText("New password"), "correct-horse-battery-staple");
  await user.type(screen.getByLabelText("Confirm new password"), "something-else");

  expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
});

test("changes the password and shows a success message", async () => {
  const posted: unknown[] = [];
  stubFetch({
    "POST /api/auth/player/change-password": async (input) => {
      posted.push(JSON.parse(await input.text()));
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Your password has been changed.")).toBeInTheDocument();
  expect(posted).toEqual([
    { password: "onetimepass", new_password: "correct-horse-battery-staple" },
  ]);
  // Cleared after success, so the coach-issued password can't be resubmitted by
  // accident and the fields don't sit filled on screen.
  expect(screen.getByLabelText("Current password")).toHaveValue("");
});

test("shows the server's message when the current password is wrong", async () => {
  stubFetch({
    "POST /api/auth/player/change-password": () =>
      new Response(JSON.stringify({ detail: "Incorrect password" }), { status: 403 }),
  });
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
});

test("shows the server's message when the new password fails its policy", async () => {
  stubFetch({
    "POST /api/auth/player/change-password": () =>
      new Response(JSON.stringify({ detail: "Password rejected by policy" }), { status: 400 }),
  });
  const user = userEvent.setup({ delay: null });
  await renderSettings();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Password rejected by policy")).toBeInTheDocument();
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
