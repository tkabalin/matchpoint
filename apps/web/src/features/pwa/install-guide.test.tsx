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

import { InstallGuide } from "./install-guide";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile";
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function stubUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
}

async function renderInstallGuide(backTo?: "/settings" | "/me/settings") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const installRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/install",
    component: () => <InstallGuide backTo={backTo} />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const playerSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me/settings",
    component: () => <h1>Player Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([installRoute, settingsRoute, playerSettingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/install"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Install MatchPoint" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows iOS steps on an iPhone", async () => {
  stubMatchMedia(false);
  stubUserAgent(IPHONE_UA);

  await renderInstallGuide();

  expect(screen.getByText(/Share/)).toBeInTheDocument();
  expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
});

test("shows Android steps on an Android phone", async () => {
  stubMatchMedia(false);
  stubUserAgent(ANDROID_UA);

  await renderInstallGuide();

  expect(screen.getByText(/menu/)).toBeInTheDocument();
  expect(screen.getByText(/Add to Home screen/)).toBeInTheDocument();
});

test("shows a generic note on a device that isn't iOS or Android", async () => {
  stubMatchMedia(false);
  stubUserAgent(DESKTOP_CHROME_UA);

  await renderInstallGuide();

  expect(
    screen.getByText("Open this page on your phone to see the steps for your device."),
  ).toBeInTheDocument();
});

test("shows a confirmation instead of steps once already installed", async () => {
  stubMatchMedia(true);
  stubUserAgent(IPHONE_UA);

  await renderInstallGuide();

  expect(screen.getByText("MatchPoint is already installed on this device.")).toBeInTheDocument();
  expect(screen.queryByText(/Share/)).not.toBeInTheDocument();
});

test("always shows what happens if signal is lost", async () => {
  stubMatchMedia(false);
  stubUserAgent(IPHONE_UA);

  await renderInstallGuide();

  expect(
    screen.getByRole("heading", { name: "If you lose signal during a match" }),
  ).toBeInTheDocument();
});

test("links back to settings", async () => {
  stubMatchMedia(false);
  stubUserAgent(IPHONE_UA);
  const user = userEvent.setup({ delay: null });

  await renderInstallGuide();
  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

// #275: mounted under the player's own route tree too, whose Settings lives
// at a different path the coach's own session can't reach.
test("links back to the player's own settings when given that backTo", async () => {
  stubMatchMedia(false);
  stubUserAgent(IPHONE_UA);
  const user = userEvent.setup({ delay: null });

  await renderInstallGuide("/me/settings");
  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Player Settings" })).toBeInTheDocument();
});
