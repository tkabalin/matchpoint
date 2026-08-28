import type { CoachRead } from "@matchpoint/api-client";
import { getCurrentCoachQueryKey } from "@matchpoint/api-client/react-query";
import { zUpdateCurrentCoachBody } from "@matchpoint/api-client/zod";
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

import { SettingsMatchDefaults } from "./settings-match-defaults";

const coach: CoachRead = {
  id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  email: "jamie@example.com",
  display_name: "Jamie Chen",
  default_surface: null,
  default_scoring_system: null,
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

async function renderPage(seed: CoachRead = coach) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(getCurrentCoachQueryKey(), seed);

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/match-defaults",
    component: SettingsMatchDefaults,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <h1>Settings</h1>,
  });
  const routeTree = rootRoute.addChildren([pageRoute, settingsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/match-defaults"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Match Defaults" });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("links back to settings", async () => {
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("link", { name: "Back to settings" }));

  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
});

test("prefills 'No preference' when the coach has no defaults set", async () => {
  await renderPage();

  expect(screen.getAllByText("No preference")).toHaveLength(2);
});

test("prefills from the coach's current defaults", async () => {
  await renderPage({ ...coach, default_surface: "clay", default_scoring_system: "no_ad_scoring" });

  expect(await screen.findByText("Clay")).toBeInTheDocument();
  expect(await screen.findByText("No-Ad Scoring")).toBeInTheDocument();
});

test("choosing a surface PATCHes it straight away", async () => {
  const patches: string[] = [];
  stubFetch({
    "PATCH /api/coaches/me": async (input) => {
      patches.push(await input.text());
      return Response.json({ ...coach, default_surface: "grass" });
    },
  });
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("combobox", { name: "Default surface" }));
  await user.click(await screen.findByRole("option", { name: "Grass" }));

  expect(await screen.findAllByText("Grass")).not.toHaveLength(0);
  expect(patches).toHaveLength(1);
  const body = JSON.parse(patches[0]!) as unknown;
  expect(body).toEqual({ default_surface: "grass" });
  expect(zUpdateCurrentCoachBody.safeParse(body).success).toBe(true);
});

test("shows a short rule explanation for the selected scoring system", async () => {
  await renderPage({ ...coach, default_scoring_system: "no_ad_scoring" });

  expect(
    await screen.findByText("Sudden death at 40-40 — next point wins the game outright."),
  ).toBeInTheDocument();
});

test("choosing a scoring system PATCHes it straight away", async () => {
  const patches: string[] = [];
  stubFetch({
    "PATCH /api/coaches/me": async (input) => {
      patches.push(await input.text());
      return Response.json({ ...coach, default_scoring_system: "pro_set" });
    },
  });
  const user = userEvent.setup({ delay: null });
  await renderPage();

  await user.click(screen.getByRole("combobox", { name: "Default scoring system" }));
  await user.click(await screen.findByRole("option", { name: "Pro Set" }));

  expect(await screen.findAllByText("Pro Set")).not.toHaveLength(0);
  expect(patches).toHaveLength(1);
  const body = JSON.parse(patches[0]!) as unknown;
  expect(body).toEqual({ default_scoring_system: "pro_set" });
  expect(zUpdateCurrentCoachBody.safeParse(body).success).toBe(true);
});

test("choosing 'No preference' PATCHes null", async () => {
  const patches: string[] = [];
  stubFetch({
    "PATCH /api/coaches/me": async (input) => {
      patches.push(await input.text());
      return Response.json({ ...coach, default_surface: null });
    },
  });
  const user = userEvent.setup({ delay: null });
  await renderPage({ ...coach, default_surface: "hard" });

  await user.click(screen.getByRole("combobox", { name: "Default surface" }));
  await user.click(await screen.findByRole("option", { name: "No preference" }));

  expect(patches).toHaveLength(1);
  const body = JSON.parse(patches[0]!) as unknown;
  expect(body).toEqual({ default_surface: null });
  expect(zUpdateCurrentCoachBody.safeParse(body).success).toBe(true);
});
