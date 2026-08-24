import type { PlayerRead } from "@matchpoint/api-client";
import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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

import { EditPlayerSheet } from "./edit-player-sheet";

// Same reasoning as profile.test.tsx: jsdom has no canvas/createImageBitmap, and
// downscaling itself is covered by downscale-image.test.ts.
vi.mock("@/lib/downscale-image", () => ({
  downscaleImage: (file: File) => Promise.resolve(file),
}));

const player: PlayerRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: "2000-01-01",
  dominant_hand: "right",
  gender: "female",
  notes: null,
  coach_id: "3f1c2b4e-0000-4000-8000-0000000000c1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

function stubFetch(routes: Record<string, () => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const handler = routes[`${input.method} ${pathname}`];
      if (!handler) throw new Error(`Unstubbed fetch: ${input.method} ${pathname}`);
      return Promise.resolve(handler());
    }),
  );
}

/**
 * The sheet calls `useNavigate` — deleting a player leaves its profile — so it needs a
 * router around it, not just a query client. Without one TanStack Router warns on every
 * render and `navigate` is inert, so a deletion could not be followed anywhere.
 */
function renderInRouter(ui: React.ReactNode, queryClient: QueryClient) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const profileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players/$playerId",
    component: () => <>{ui}</>,
  });
  const rosterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/players",
    component: () => <h1>Players</h1>,
  });
  const routeTree = rootRoute.addChildren([profileRoute, rosterRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/players/${player.id}`] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // Await the router's own load rather than leaving the first paint inside a findBy*
  // poll, whose budget is the narrowest in the suite: docs/testing.md.
  return router.load();
}

async function renderSheet(seed: PlayerRead = player) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await renderInRouter(<EditPlayerSheet player={seed} open onOpenChange={() => {}} />, queryClient);
}

/**
 * `EditPlayerSheet` reads `player` as a prop, not its own query — a photo mutation
 * only invalidates, same as `save`/`remove` already do. In the app, `player-profile.tsx`
 * owns the `getPlayer` query and re-passes fresh props once that invalidation
 * refetches, which is what actually makes the sheet's own avatar update. This
 * harness reproduces that same ownership so the round trip is genuinely exercised,
 * rather than asserting something this component doesn't control on its own.
 */
function PlayerProfileHarness({ playerId }: { playerId: string }) {
  const { data } = useQuery(getPlayerOptions({ path: { player_id: playerId } }));
  if (!data) return null;
  return <EditPlayerSheet player={data} open onOpenChange={() => {}} />;
}

async function renderWithOwnedQuery(seed: PlayerRead = player) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await renderInRouter(<PlayerProfileHarness playerId={seed.id} />, queryClient);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows initials when the player has no photo", async () => {
  await renderSheet();

  expect(screen.getByText("AN")).toBeInTheDocument();
});

test("choosing a photo uploads it and shows it in place of initials", async () => {
  let current: PlayerRead = player;
  stubFetch({
    [`GET /api/players/${player.id}`]: () => Response.json(current),
    [`POST /api/players/${player.id}/photo`]: () => {
      current = { ...player, photo_url: "/api/media/abc.webp" };
      return Response.json(current);
    },
  });
  const user = userEvent.setup();
  await renderWithOwnedQuery();

  await user.click(await screen.findByRole("button", { name: "Change Amahle's photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  const img = await screen.findByAltText("");
  expect(img).toHaveAttribute("src", "/api/media/abc.webp");
  expect(screen.queryByText("AN")).not.toBeInTheDocument();
});

test("removing a photo restores initials", async () => {
  const withPhoto = { ...player, photo_url: "/api/media/abc.webp" };
  let current: PlayerRead = withPhoto;
  stubFetch({
    [`GET /api/players/${player.id}`]: () => Response.json(current),
    [`DELETE /api/players/${player.id}/photo`]: () => {
      current = player;
      return Response.json(current);
    },
  });
  const user = userEvent.setup();
  await renderWithOwnedQuery(withPhoto);

  await user.click(await screen.findByRole("button", { name: "Change Amahle's photo" }));
  await user.click(await screen.findByRole("button", { name: "Remove photo" }));

  expect(await screen.findByText("AN")).toBeInTheDocument();
});

test("no Remove photo option when there is no photo to remove", async () => {
  const user = userEvent.setup();
  await renderSheet();

  await user.click(screen.getByRole("button", { name: "Change Amahle's photo" }));

  expect(await screen.findByRole("button", { name: "Choose photo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
});

test("generating a transfer code shows it once, with a copy button", async () => {
  // jsdom implements no Clipboard API at all, so navigator.clipboard is normally
  // undefined — defining it directly (rather than vi.stubGlobal("navigator", ...))
  // is what actually takes, since navigator itself isn't reassignable in jsdom.
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubFetch({
    [`POST /api/players/${player.id}/transfer-code`]: () => Response.json({ code: "ABCD1234" }),
  });
  const user = userEvent.setup();
  await renderSheet();

  await user.click(screen.getByRole("button", { name: "Transfer to another coach" }));
  await user.click(await screen.findByRole("button", { name: "Generate code" }));

  expect(await screen.findByLabelText("Transfer code")).toHaveValue("ABCD1234");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await user.click(screen.getByRole("button", { name: "Copy code" }));
  await screen.findByRole("button", { name: "Copied" });
  expect(writeText).toHaveBeenCalledWith("ABCD1234");
});

test("shows 'Manage transfer code' and lets the coach cancel a pending one", async () => {
  const pending = { ...player, has_transfer_code: true };
  let current: PlayerRead = pending;
  stubFetch({
    [`GET /api/players/${player.id}`]: () => Response.json(current),
    [`DELETE /api/players/${player.id}/transfer-code`]: () => {
      current = player;
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup();
  await renderWithOwnedQuery(pending);

  await user.click(await screen.findByRole("button", { name: "Manage transfer code" }));
  await user.click(await screen.findByRole("button", { name: "Cancel transfer" }));

  expect(
    await screen.findByRole("button", { name: "Transfer to another coach" }),
  ).toBeInTheDocument();
});

test("generating a new code while one is pending", async () => {
  const user = userEvent.setup();
  stubFetch({
    [`POST /api/players/${player.id}/transfer-code`]: () => Response.json({ code: "FRESH9999" }),
  });
  await renderSheet({ ...player, has_transfer_code: true });

  await user.click(screen.getByRole("button", { name: "Manage transfer code" }));
  await user.click(await screen.findByRole("button", { name: "Generate a new code instead" }));

  expect(await screen.findByLabelText("Transfer code")).toHaveValue("FRESH9999");
});
