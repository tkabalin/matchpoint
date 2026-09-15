import type { PlayerNoteRead, PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerDetailsCard } from "./player-details-card";

const BASE_PLAYER: PlayerRead = {
  id: "player-1",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: null,
  coach_id: "coach-1",
  has_transfer_code: false,
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const SELF_PLAYER: PlayerSelfRead = {
  id: "player-1",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  photo_url: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

const NOTE: PlayerNoteRead = {
  id: "note-1",
  player_id: "player-1",
  body: "Serves wide on the ad court whenever the score is tight.",
  focus_areas: ["tactical"],
  recorded_on: "2026-08-01",
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
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

function renderCard(player: PlayerRead | PlayerSelfRead = BASE_PLAYER, onEdit?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerDetailsCard player={player} onEdit={onEdit} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows username, date of birth and dominant hand", async () => {
  stubFetch({ "GET /api/players/player-1/notes": () => Response.json([]) });
  renderCard(BASE_PLAYER, () => {});

  expect(screen.getByText("Player details")).toBeInTheDocument();
  expect(screen.getByText("nksama001")).toBeInTheDocument();
  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  await screen.findByRole("button", { name: "Quick note" });
});

// No illustrated empty state: it was taking up more room than a coach
// scanning this card at a glance needed, and the Quick note button already
// says what to do next on its own.
test("shows no empty-state illustration when there are no notes yet", async () => {
  stubFetch({ "GET /api/players/player-1/notes": () => Response.json([]) });
  renderCard(BASE_PLAYER, () => {});

  await screen.findByRole("button", { name: "Quick note" });
  expect(screen.queryByText("No notes yet")).not.toBeInTheDocument();
});

test("shows a dash for date of birth and dominant hand when unset", async () => {
  stubFetch({ "GET /api/players/player-1/notes": () => Response.json([]) });
  renderCard({ ...BASE_PLAYER, date_of_birth: null, dominant_hand: null }, () => {});

  await screen.findByRole("button", { name: "Quick note" });
  expect(screen.getAllByText("—")).toHaveLength(2);
});

test("Edit lives in this card and fires the handler", async () => {
  stubFetch({ "GET /api/players/player-1/notes": () => Response.json([]) });
  const onEdit = vi.fn();
  const user = userEvent.setup({ delay: null });
  renderCard(BASE_PLAYER, onEdit);

  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(onEdit).toHaveBeenCalledOnce();
});

// #203: a player viewing their own details gets PlayerSelfRead (no `notes` — coach
// notes are deliberately private) and no edit action (editing is coach-only). No
// notes fetch at all, not just a hidden section.
test("shows a player's own details with no Edit button and no notes section", () => {
  renderCard(SELF_PLAYER);

  expect(screen.getByText("nksama001")).toBeInTheDocument();
  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByText("Notes")).not.toBeInTheDocument();
});

test("lists an existing note with its focus area and date", async () => {
  stubFetch({ "GET /api/players/player-1/notes": () => Response.json([NOTE]) });
  renderCard(BASE_PLAYER, () => {});

  expect(await screen.findByText(NOTE.body)).toBeInTheDocument();
  expect(screen.getByText("Aug 1")).toBeInTheDocument();
});

test("Quick note opens a composer, and saving creates the note", async () => {
  const createdBodies: string[] = [];
  stubFetch({
    "GET /api/players/player-1/notes": () => Response.json([]),
    "POST /api/players/player-1/notes": async (input) => {
      const body = JSON.parse(await input.text()) as { body: string };
      createdBodies.push(body.body);
      return Response.json(
        { ...NOTE, id: "note-2", body: body.body, focus_areas: [] },
        { status: 201 },
      );
    },
  });
  const user = userEvent.setup({ delay: null });
  renderCard(BASE_PLAYER, () => {});

  await user.click(await screen.findByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Quick pre-match note");
  await user.click(screen.getByRole("button", { name: "Save note" }));

  await vi.waitFor(() => expect(createdBodies).toEqual(["Quick pre-match note"]));
});

test("Edit note opens the composer prefilled, and Delete asks for confirmation first", async () => {
  let deleted = false;
  stubFetch({
    "GET /api/players/player-1/notes": () => Response.json(deleted ? [] : [NOTE]),
    "DELETE /api/players/player-1/notes/note-1": () => {
      deleted = true;
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup({ delay: null });
  renderCard(BASE_PLAYER, () => {});
  await screen.findByText(NOTE.body);

  await user.click(screen.getByRole("button", { name: "Edit note" }));
  expect(screen.getByDisplayValue(NOTE.body)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Delete note" }));
  const confirm = within(screen.getByText("Delete this note?").closest("div")!);
  await user.click(confirm.getByRole("button", { name: "Delete" }));

  await vi.waitFor(() => expect(screen.queryByText(NOTE.body)).not.toBeInTheDocument());
});
