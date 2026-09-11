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

// Creating a player mints a one-time username and password (#202); the coach has to
// see and copy them, so the sheet now stays open on a reveal step instead of closing
// immediately, and only "Done" on that step calls onOpenChange(false).
function playerCreatedResponse(body: Record<string, unknown>) {
  return Response.json(
    { id: NEW_PLAYER_ID, username: "nksama001", password: "correct-horse-battery", ...body },
    { status: 201 },
  );
}

test("adds a player with no photo, then reveals credentials before closing", async () => {
  const created: unknown[] = [];
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      created.push(body);
      return playerCreatedResponse(body);
    },
  });
  const user = userEvent.setup({ delay: null });
  const { onOpenChange } = renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  expect(
    await screen.findByRole("heading", { name: "Amahle's sign-in details" }),
  ).toBeInTheDocument();
  expect(created).toHaveLength(1);
  expect(zCreatePlayerBody.safeParse(created[0]).success).toBe(true);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);

  await user.click(screen.getByRole("button", { name: "Done" }));

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

// #219: this is the only place the coach ever sees these values.
test("reveals the generated username and password after creating a player", async () => {
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      return playerCreatedResponse(body);
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  expect(await screen.findByLabelText("Username")).toHaveValue("nksama001");
  expect(screen.getByLabelText("Password")).toHaveValue("correct-horse-battery");
});

// #219: the password is not retrievable again once the coach dismisses the reveal.
test("Done clears the credentials and returns to the form", async () => {
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      return playerCreatedResponse(body);
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));
  await screen.findByRole("heading", { name: "Amahle's sign-in details" });

  await user.click(screen.getByRole("button", { name: "Done" }));

  expect(screen.getByRole("heading", { name: "Add a player" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});

test("adds a player with a photo, uploaded after creation", async () => {
  const photoUploads: { playerId: string; url: string }[] = [];
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      const parsed = zCreatePlayerBody.safeParse(body);
      expect(parsed.success).toBe(true);
      return playerCreatedResponse(body);
    },
    [`POST /api/players/${NEW_PLAYER_ID}/photo`]: (input) => {
      photoUploads.push({ playerId: NEW_PLAYER_ID, url: input.url });
      return Response.json({ id: NEW_PLAYER_ID, photo_url: "/api/media/abc.webp" });
    },
  });
  const user = userEvent.setup({ delay: null });
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

test("a photo-upload failure still creates the player and reaches the reveal step", async () => {
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      return playerCreatedResponse({ ...body, photo_url: null });
    },
    [`POST /api/players/${NEW_PLAYER_ID}/photo`]: () => new Response(null, { status: 500 }),
  });
  const user = userEvent.setup({ delay: null });
  const { onOpenChange } = renderSheet();

  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  expect(
    await screen.findByRole("heading", { name: "Amahle's sign-in details" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Could not add that player/)).not.toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);

  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

// Hand and notes are the two fields no other test fills, and notes carries a trim: an
// untouched box has to reach the API as null, not as an empty string.
test("hand and notes reach the request, and an untouched notes box sends null", async () => {
  const created: Record<string, unknown>[] = [];
  stubFetch({
    "POST /api/players": async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      created.push(body);
      return playerCreatedResponse(body);
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Left" }));
  await user.type(screen.getByLabelText("Notes"), "Prefers early sessions");
  await user.click(screen.getByRole("button", { name: "Add player" }));

  await vi.waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]!.dominant_hand).toBe("left");
  expect(created[0]!.notes).toBe("Prefers early sessions");
  expect(zCreatePlayerBody.safeParse(created[0]).success).toBe(true);
});

test("a refused creation keeps the sheet open and shows the server's reason", async () => {
  stubFetch({
    "POST /api/players": () => Response.json({ detail: "That username is taken" }, { status: 409 }),
  });
  const user = userEvent.setup({ delay: null });
  const { onOpenChange } = renderSheet();

  await fillRequiredFields(user);
  await user.click(screen.getByRole("button", { name: "Add player" }));

  expect(await screen.findByText("That username is taken")).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

// Dismissing has to clear the draft: the sheet is remounted open by the roster, so a
// half-typed player left behind would reappear as though the coach had started it.
test("dismissing the sheet clears what was typed", async () => {
  const user = userEvent.setup({ delay: null });
  const { onOpenChange } = renderSheet();
  await user.type(screen.getByLabelText("First name"), "Amahle");

  await user.click(screen.getByRole("button", { name: "Close" }));

  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByLabelText("First name")).toHaveValue("");
});

test("a pending photo can be removed again before the player exists", async () => {
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  await user.click(await screen.findByRole("button", { name: "Choose photo" }));
  const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
  await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

  // Reopening now offers Remove, which it did not before a photo was chosen.
  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  await user.click(await screen.findByRole("button", { name: "Remove photo" }));

  await user.click(screen.getByRole("button", { name: "Add a player photo" }));
  expect(await screen.findByRole("button", { name: "Choose photo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
});
