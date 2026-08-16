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

import { Settings } from "./settings";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders Settings inside a real (in-memory) router and its own QueryClient, seeded
 * with a dummy cached query so a test can prove sign-out actually clears it — the
 * next coach on this device would otherwise see the previous coach's roster. */
async function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["players"], [{ id: "1", first_name: "Amahle" }]);

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
  await screen.findByRole("heading", { name: "Settings" });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  const user = userEvent.setup();
  const queryClient = await renderSettings();

  await user.click(screen.getByRole("button", { name: "Sign Out" }));
  const dialog = await screen.findByRole("alertdialog");
  // Two "Sign Out" buttons exist once the dialog is open: the page's own trigger and
  // the dialog's confirm action — scope to the dialog for the one that matters here.
  await user.click(within(dialog).getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByText("You've been signed out.")).toBeInTheDocument();
  expect(queryClient.getQueryData(["players"])).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
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
