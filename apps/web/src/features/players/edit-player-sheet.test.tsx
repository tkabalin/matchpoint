import type { PlayerRead } from "@matchpoint/api-client";
import { getPlayerOptions } from "@matchpoint/api-client/react-query";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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

function renderSheet(seed: PlayerRead = player) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EditPlayerSheet player={seed} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
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

function renderWithOwnedQuery(seed: PlayerRead = player) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerProfileHarness playerId={seed.id} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows initials when the player has no photo", () => {
  renderSheet();

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
  renderWithOwnedQuery();

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
  renderWithOwnedQuery(withPhoto);

  await user.click(await screen.findByRole("button", { name: "Change Amahle's photo" }));
  await user.click(await screen.findByRole("button", { name: "Remove photo" }));

  expect(await screen.findByText("AN")).toBeInTheDocument();
});

test("no Remove photo option when there is no photo to remove", async () => {
  const user = userEvent.setup();
  renderSheet();

  await user.click(screen.getByRole("button", { name: "Change Amahle's photo" }));

  expect(await screen.findByRole("button", { name: "Choose photo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
});
