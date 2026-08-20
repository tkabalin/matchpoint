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

import { SettingsAccount } from "./settings-account";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

async function renderSettingsAccount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/account",
    component: SettingsAccount,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/forgot-password",
    component: () => <h1>Reset Password</h1>,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([
    accountRoute,
    settingsRoute,
    forgotPasswordRoute,
    signInRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/account"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Account & Security" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("links back to settings", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("change password asks for confirmation before leaving Settings", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Change password?")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Reset Password" })).not.toBeInTheDocument();
});

test("confirming the change-password dialog navigates to the forgot-password flow", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Change password" }));
  await screen.findByText("Change password?");
  await user.click(screen.getByRole("button", { name: "Continue" }));

  expect(await screen.findByRole("heading", { name: "Reset Password" })).toBeInTheDocument();
});

test("cancelling the change-password dialog makes no navigation happen", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Change password" }));
  await screen.findByText("Change password?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Change password?")).not.toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Account & Security" })).toBeInTheDocument();
});

test("offers Sign Out, grouped with the other session actions", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("Sign out?")).toBeInTheDocument();
});

test("signing out of all other sessions shows a confirm then a success dialog", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Sign out of all other sessions" }));
  expect(await screen.findByText("Sign out of all other sessions?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("Signed out of all other sessions.")).toBeInTheDocument();
});

test("cancelling the sign-out-all-sessions confirm makes no request", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Sign out of all other sessions" }));
  await screen.findByText("Sign out of all other sessions?");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Sign out of all other sessions?")).not.toBeInTheDocument();
});

test("opens the delete-account flow", async () => {
  const user = userEvent.setup();
  await renderSettingsAccount();

  await user.click(screen.getByRole("button", { name: "Delete account" }));

  expect(
    await screen.findByRole("heading", { name: "Deleting your account also deletes your players" }),
  ).toBeInTheDocument();
});
