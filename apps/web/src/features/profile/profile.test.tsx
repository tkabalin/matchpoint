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

import { Profile } from "./profile";

// jsdom has no canvas/createImageBitmap, and none of these tests are about the
// downscaling itself (that's downscale-image.test.ts) — so it's stubbed to a no-op
// pass-through here, same reasoning add-player-sheet-style tests give for stubbing
// unrelated browser APIs.
vi.mock("@/lib/downscale-image", () => ({
  downscaleImage: (file: File) => Promise.resolve(file),
}));

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

async function renderProfile(seed: CoachRead = coach) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(getCurrentCoachQueryKey(), seed);

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    component: Profile,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const routeTree = rootRoute.addChildren([profileRoute, homeRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/profile"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: seed.display_name });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the coach's name and email", async () => {
  await renderProfile();

  expect(screen.getByRole("heading", { name: "Jamie Chen" })).toBeInTheDocument();
  expect(screen.getByText("jamie@example.com")).toBeInTheDocument();
});

test("shows initials when no photo is set", async () => {
  await renderProfile();

  expect(screen.getByText("JC")).toBeInTheDocument();
});

test("links back to home", async () => {
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("link", { name: "Back to home" }));

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test("editing the name PATCHes only display_name and updates live", async () => {
  const patches: string[] = [];
  stubFetch({
    "PATCH /api/coaches/me": async (input) => {
      patches.push(await input.text());
      return Response.json({ ...coach, display_name: "Jamie C." });
    },
  });
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Edit display name" }));
  const nameField = await screen.findByRole("textbox", { name: "Display name" });
  await user.clear(nameField);
  await user.type(nameField, "Jamie C.");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("heading", { name: "Jamie C." })).toBeInTheDocument();
  expect(patches).toHaveLength(1);
  const body = JSON.parse(patches[0]!) as unknown;
  expect(body).toEqual({ display_name: "Jamie C." });
  expect(zUpdateCurrentCoachBody.safeParse(body).success).toBe(true);
});

test("saving with nothing changed closes without a request", async () => {
  const patches: string[] = [];
  stubFetch({
    "PATCH /api/coaches/me": async (input) => {
      patches.push(await input.text());
      return Response.json(coach);
    },
  });
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Edit display name" }));
  await screen.findByRole("textbox", { name: "Display name" });
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.queryByRole("textbox", { name: "Display name" })).not.toBeInTheDocument();
  expect(patches).toEqual([]);
});

test("choosing a photo uploads it and shows it in place of initials", async () => {
  const photoCoach = { ...coach, photo_url: "/api/media/abc.webp" };
  stubFetch({
    "POST /api/coaches/me/photo": () => Response.json(photoCoach),
  });
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Change profile photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  // alt="" is deliberate (decorative; the name is shown elsewhere), which computes to
  // role="presentation" rather than "img" — getByAltText matches on the attribute
  // directly rather than the computed role, so it still finds it.
  const img = await screen.findByAltText("");
  expect(img).toHaveAttribute("src", "/api/media/abc.webp");
  expect(screen.queryByText("JC")).not.toBeInTheDocument();
});

test("Remove photo is offered only once one is set, and clears it", async () => {
  stubFetch({
    "DELETE /api/coaches/me/photo": () => Response.json(coach),
  });
  const user = userEvent.setup();
  await renderProfile({ ...coach, photo_url: "/api/media/abc.webp" });

  await user.click(screen.getByRole("button", { name: "Change profile photo" }));
  await user.click(await screen.findByRole("button", { name: "Remove photo" }));

  expect(await screen.findByText("JC")).toBeInTheDocument();
});

test("no Remove photo option when there is no photo to remove", async () => {
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Change profile photo" }));

  expect(await screen.findByRole("button", { name: "Choose photo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
});

// The photo hook's failure paths surface as an Alert on this page, and nothing made
// either request fail — so `photoError` was never non-null anywhere in the suite, and
// the Alert that reports it had never rendered.

test("a failed photo upload says so, in the server's own words", async () => {
  stubFetch({
    "POST /api/coaches/me/photo": () =>
      Response.json({ detail: "That image is too large" }, { status: 413 }),
  });
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Change profile photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

  expect(await screen.findByText("That image is too large")).toBeInTheDocument();
  expect(screen.getByText("JC")).toBeInTheDocument();
});

test("a failed photo removal leaves the photo and explains itself", async () => {
  stubFetch({
    "DELETE /api/coaches/me/photo": () => new Response(null, { status: 500 }),
  });
  const user = userEvent.setup();
  await renderProfile({ ...coach, photo_url: "/api/media/abc.webp" });

  await user.click(screen.getByRole("button", { name: "Change profile photo" }));
  await user.click(await screen.findByRole("button", { name: "Remove photo" }));

  expect(await screen.findByText("Could not remove that photo.")).toBeInTheDocument();
  expect(screen.getByAltText("")).toHaveAttribute("src", "/api/media/abc.webp");
});

test("a refused name change keeps the sheet open with the typed name", async () => {
  stubFetch({
    "PATCH /api/coaches/me": () =>
      Response.json({ detail: "That name is not allowed" }, { status: 422 }),
  });
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Edit display name" }));
  const nameField = await screen.findByRole("textbox", { name: "Display name" });
  await user.clear(nameField);
  await user.type(nameField, "Jamie C.");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("That name is not allowed")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue("Jamie C.");
});

// Dismissing has to drop the draft: the name is re-seeded from the coach record each
// time the sheet opens, so an abandoned edit reappearing would look saved.
test("dismissing the edit sheet discards the typed name", async () => {
  const user = userEvent.setup();
  await renderProfile();

  await user.click(screen.getByRole("button", { name: "Edit display name" }));
  const nameField = await screen.findByRole("textbox", { name: "Display name" });
  await user.clear(nameField);
  await user.type(nameField, "Someone Else");
  await user.click(screen.getByRole("button", { name: "Close" }));

  await user.click(screen.getByRole("button", { name: "Edit display name" }));

  expect(await screen.findByRole("textbox", { name: "Display name" })).toHaveValue("Jamie Chen");
});
