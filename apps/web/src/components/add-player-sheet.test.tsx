import { zCreatePlayerBody } from "@matchpoint/api-client/zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AddPlayerSheet } from "./add-player-sheet";

// Same reasoning as profile.test.tsx: jsdom has no canvas/createImageBitmap, and
// downscaling itself is covered by downscale-image.test.ts.
vi.mock("@/lib/downscale-image", () => ({
  downscaleImage: (file: File) => Promise.resolve(file),
}));

const NEW_PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000099";

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

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AddPlayerSheet open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First name"), "Amahle");
  await user.type(screen.getByLabelText("Last name"), "Nkosi");
  await user.type(screen.getByLabelText("Date of birth"), "2000-01-01");
  // "Female" contains "male" as a substring, so an anchored regex is what
  // distinguishes the two buttons.
  await user.click(screen.getByRole("button", { name: /^Male$/ }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("adds a player with no photo", async () => {
  const created: unknown[] = [];
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      created.push(body);
      return Response.json({ id: NEW_PLAYER_ID, ...body }, { status: 201 });
    },
  });
  const user = userEvent.setup();
  const { onOpenChange } = renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(created).toHaveLength(1);
  expect(zCreatePlayerBody.safeParse(created[0]).success).toBe(true);
});

test("adds a player with a photo, uploaded after creation", async () => {
  const photoUploads: { playerId: string; url: string }[] = [];
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      const parsed = zCreatePlayerBody.safeParse(body);
      expect(parsed.success).toBe(true);
      return Response.json({ id: NEW_PLAYER_ID, ...body }, { status: 201 });
    },
    [`POST /api/players/${NEW_PLAYER_ID}/photo`]: (input) => {
      photoUploads.push({ playerId: NEW_PLAYER_ID, url: input.url });
      return Response.json({ id: NEW_PLAYER_ID, photo_url: "/api/media/abc.webp" });
    },
  });
  const user = userEvent.setup();
  renderSheet();

  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  await vi.waitFor(() => expect(photoUploads).toHaveLength(1));
});

test("a photo-upload failure still creates the player and closes the sheet", async () => {
  stubFetch({
    "POST /api/players": async () =>
      Response.json({ id: NEW_PLAYER_ID, photo_url: null }, { status: 201 }),
    [`POST /api/players/${NEW_PLAYER_ID}/photo`]: () => new Response(null, { status: 500 }),
  });
  const user = userEvent.setup();
  const { onOpenChange } = renderSheet();

  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(screen.queryByText(/Could not add that player/)).not.toBeInTheDocument();
});
