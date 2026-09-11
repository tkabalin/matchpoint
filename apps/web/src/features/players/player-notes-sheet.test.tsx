import type { PlayerNoteRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerNotesSheet } from "./player-notes-sheet";

const PLAYER_ID = "player-1";

function makeNote(overrides: Partial<PlayerNoteRead> = {}): PlayerNoteRead {
  return {
    id: "note-1",
    player_id: PLAYER_ID,
    body: "Worked on toss height on 2nd serve today.",
    recorded_on: "2026-08-15",
    focus_areas: ["technical"],
    created_at: "2026-08-15T09:00:00Z",
    updated_at: "2026-08-15T09:00:00Z",
    ...overrides,
  };
}

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

/** Reads the list once from `routes` and keeps re-serving whatever `notes` currently
 *  holds, so a create/update/delete test can assert the list re-fetches with the
 *  server's own effect already applied, the way `invalidateQueries` actually behaves. */
function stubNotesList(initial: PlayerNoteRead[]) {
  const notes = [...initial];
  const routes: Record<string, (input: Request) => Response | Promise<Response>> = {
    [`GET /api/players/${PLAYER_ID}/notes`]: () => Response.json(notes),
  };
  return { notes, routes };
}

function renderSheet(open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerNotesSheet playerId={PLAYER_ID} open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("lists the player's notes, theme shown as an icon rather than a colored tag", async () => {
  stubFetch(stubNotesList([makeNote()]).routes);
  renderSheet();

  expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
  expect(await screen.findByText(/Worked on toss height on 2nd serve today/)).toBeInTheDocument();
  // The theme is a titled icon now, not visible "technical" text on a colored badge.
  expect(screen.queryByText("technical")).not.toBeInTheDocument();
  expect(screen.getByTitle("technical")).toBeInTheDocument();
});

test("renders nothing when the sheet is closed", () => {
  renderSheet(false);

  expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
});

test("shows an empty state with no notes yet", async () => {
  stubFetch(stubNotesList([]).routes);
  renderSheet();

  expect(await screen.findByText("No notes yet")).toBeInTheDocument();
});

test("shows a real error when the list fails to load", async () => {
  stubFetch({
    [`GET /api/players/${PLAYER_ID}/notes`]: () => new Response(null, { status: 500 }),
  });
  renderSheet();

  expect(await screen.findByText("Could not load notes.")).toBeInTheDocument();
});

test("Quick note opens a composer defaulted to today, not a disabled button", async () => {
  const user = userEvent.setup({ delay: null });
  stubFetch(stubNotesList([]).routes);
  renderSheet();
  await screen.findByText("No notes yet");

  const quickNote = screen.getByRole("button", { name: "Quick note" });
  expect(quickNote).toBeEnabled();
  await user.click(quickNote);

  expect(screen.getByPlaceholderText("What did you notice?")).toBeInTheDocument();
  const todayIso = new Date().toISOString().slice(0, 10);
  expect(screen.getByLabelText("Date")).toHaveValue(todayIso);
});

test("saving a quick note sends body, recorded_on and focus_areas, then re-lists", async () => {
  const { notes, routes } = stubNotesList([]);
  const created: Record<string, unknown>[] = [];
  stubFetch({
    ...routes,
    [`POST /api/players/${PLAYER_ID}/notes`]: async (input) => {
      const body = JSON.parse(await input.text()) as Record<string, unknown>;
      created.push(body);
      const note = makeNote({
        id: "note-new",
        body: body.body as string,
        recorded_on: body.recorded_on as string,
        focus_areas: body.focus_areas as PlayerNoteRead["focus_areas"],
      });
      notes.push(note);
      return Response.json(note, { status: 201 });
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(
    screen.getByPlaceholderText("What did you notice?"),
    "Footwork looked sharper on the return today.",
  );
  await user.click(screen.getByRole("button", { name: "physical" }));
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(
    await screen.findByText("Footwork looked sharper on the return today."),
  ).toBeInTheDocument();
  expect(created).toHaveLength(1);
  expect(created[0]!.body).toBe("Footwork looked sharper on the return today.");
  expect(created[0]!.focus_areas).toEqual(["physical"]);
});

test("Save note is disabled — shows an inline error — for an empty body", async () => {
  const user = userEvent.setup({ delay: null });
  stubFetch(stubNotesList([]).routes);
  renderSheet();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(screen.getByText("Note can't be empty.")).toBeInTheDocument();
});

// #250/#252: the whole point of wiring this up — a future date used to be
// impossible to send by accident since there was no write endpoint at all;
// now the client-side twin of the server's own bound has to catch it first.
test("a future date blocks submit and sends nothing", async () => {
  const { routes } = stubNotesList([]);
  let posted = false;
  stubFetch({
    ...routes,
    [`POST /api/players/${PLAYER_ID}/notes`]: () => {
      posted = true;
      return Response.json(makeNote(), { status: 201 });
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Backdated by a decade");
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await user.clear(screen.getByLabelText("Date"));
  await user.type(screen.getByLabelText("Date"), tomorrow);
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(screen.getByText("Note date cannot be in the future.")).toBeInTheDocument();
  expect(posted).toBe(false);
});

test("Edit prefills the note and PATCHes only what changed", async () => {
  const existing = makeNote({ focus_areas: ["technical", "mental"] });
  const { notes, routes } = stubNotesList([existing]);
  let patchBody: Record<string, unknown> | undefined;
  stubFetch({
    ...routes,
    [`PATCH /api/players/${PLAYER_ID}/notes/${existing.id}`]: async (input) => {
      patchBody = JSON.parse(await input.text()) as Record<string, unknown>;
      notes[0] = { ...notes[0]!, ...patchBody };
      return Response.json(notes[0]);
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText(existing.body);

  await user.click(screen.getByRole("button", { name: "Edit note" }));
  const textarea = screen.getByPlaceholderText("What did you notice?");
  expect(textarea).toHaveValue(existing.body);
  await user.clear(textarea);
  await user.type(textarea, "Updated body");
  await user.click(screen.getByRole("button", { name: "Save note" }));

  await screen.findByText("Updated body");
  expect(patchBody).toEqual({ body: "Updated body" });
});

test("clearing every focus area on edit sends an empty list, not nothing", async () => {
  const existing = makeNote({ focus_areas: ["technical"] });
  const { notes, routes } = stubNotesList([existing]);
  let patchBody: Record<string, unknown> | undefined;
  stubFetch({
    ...routes,
    [`PATCH /api/players/${PLAYER_ID}/notes/${existing.id}`]: async (input) => {
      patchBody = JSON.parse(await input.text()) as Record<string, unknown>;
      notes[0] = { ...notes[0]!, ...patchBody };
      return Response.json(notes[0]);
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText(existing.body);

  await user.click(screen.getByRole("button", { name: "Edit note" }));
  await user.click(screen.getByRole("button", { name: "technical" }));
  await user.click(screen.getByRole("button", { name: "Save note" }));

  await screen.findByRole("button", { name: "Edit note" });
  expect(patchBody).toEqual({ focus_areas: [] });
});

test("deleting a note asks for confirmation before removing it", async () => {
  const existing = makeNote();
  const { notes, routes } = stubNotesList([existing]);
  stubFetch({
    ...routes,
    [`DELETE /api/players/${PLAYER_ID}/notes/${existing.id}`]: () => {
      notes.splice(0, notes.length);
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  const noteText = await screen.findByText(existing.body);

  await user.click(screen.getByRole("button", { name: "Delete note" }));

  expect(screen.getByText("Delete this note?")).toBeInTheDocument();
  expect(noteText).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Delete" }));

  expect(screen.queryByText(existing.body)).not.toBeInTheDocument();
});

test("Cancel on the delete confirmation keeps the note", async () => {
  stubFetch(stubNotesList([makeNote()]).routes);
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText(/Worked on toss height on 2nd serve today/);

  await user.click(screen.getByRole("button", { name: "Delete note" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Delete this note?")).not.toBeInTheDocument();
  expect(screen.getByText(/Worked on toss height on 2nd serve today/)).toBeInTheDocument();
});

test("a failed save surfaces the server's reason", async () => {
  const { routes } = stubNotesList([]);
  stubFetch({
    ...routes,
    [`POST /api/players/${PLAYER_ID}/notes`]: () =>
      Response.json({ detail: "note date cannot be more than 10 years ago" }, { status: 422 }),
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Old session");
  await user.click(screen.getByRole("button", { name: "Save note" }));

  expect(await screen.findByText("note date cannot be more than 10 years ago")).toBeInTheDocument();
});

/**
 * The tests above hold `open` fixed, which no real caller does. This harness owns it
 * the way the profile page does, so the sheet can actually be closed and reopened —
 * the only way to observe what a dismissal is supposed to clear.
 */
function ControlledNotes() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen notes
      </button>
      <PlayerNotesSheet playerId={PLAYER_ID} open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderControlled() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ControlledNotes />
    </QueryClientProvider>,
  );
}

test("Cancel backs out of the composer without saving", async () => {
  stubFetch(stubNotesList([]).routes);
  const user = userEvent.setup({ delay: null });
  renderControlled();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Half a thought");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByPlaceholderText("What did you notice?")).not.toBeInTheDocument();
  expect(screen.queryByText("Half a thought")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Quick note" })).toBeInTheDocument();
});

// An abandoned draft has to go with the sheet. Reopening onto someone else's half-typed
// note would read as a note the coach had started about this player.
test("closing mid-compose discards the draft rather than restoring it", async () => {
  stubFetch(stubNotesList([]).routes);
  const user = userEvent.setup({ delay: null });
  renderControlled();
  await screen.findByText("No notes yet");

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Half a thought");
  await user.click(screen.getByRole("button", { name: "Close" }));

  await user.click(screen.getByRole("button", { name: "Reopen notes" }));

  expect(await screen.findByRole("button", { name: "Quick note" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("What did you notice?")).not.toBeInTheDocument();
});
