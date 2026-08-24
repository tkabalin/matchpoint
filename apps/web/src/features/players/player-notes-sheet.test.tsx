import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { PlayerNotesSheet } from "./player-notes-sheet";

function renderSheet(open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerNotesSheet playerId="player-1" open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

test("lists the player's notes, theme shown as an icon rather than a colored tag", async () => {
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

test("Quick note opens a composer, not a disabled button", async () => {
  const user = userEvent.setup();
  renderSheet();
  await screen.findByRole("heading", { name: "Notes" });

  const quickNote = screen.getByRole("button", { name: "Quick note" });
  expect(quickNote).toBeEnabled();
  await user.click(quickNote);

  expect(screen.getByPlaceholderText("What did you notice?")).toBeInTheDocument();
});

test("saving a quick note adds it to the list with its chosen theme", async () => {
  const user = userEvent.setup();
  renderSheet();
  await screen.findByRole("heading", { name: "Notes" });

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
  expect(screen.getAllByTitle("physical").length).toBeGreaterThan(0);
});

test("Save note is disabled until something is typed", async () => {
  const user = userEvent.setup();
  renderSheet();
  await screen.findByRole("heading", { name: "Notes" });

  await user.click(screen.getByRole("button", { name: "Quick note" }));

  expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
});

test("deleting a note asks for confirmation before removing it", async () => {
  const user = userEvent.setup();
  renderSheet();
  const noteText = await screen.findByText(/Worked on toss height on 2nd serve today/);

  await user.click(screen.getAllByRole("button", { name: "Delete note" })[0]!);

  expect(screen.getByText("Delete this note?")).toBeInTheDocument();
  expect(noteText).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Delete" }));

  expect(screen.queryByText(/Worked on toss height on 2nd serve today/)).not.toBeInTheDocument();
});

test("Cancel on the delete confirmation keeps the note", async () => {
  const user = userEvent.setup();
  renderSheet();
  await screen.findByText(/Worked on toss height on 2nd serve today/);

  await user.click(screen.getAllByRole("button", { name: "Delete note" })[0]!);
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByText("Delete this note?")).not.toBeInTheDocument();
  expect(screen.getByText(/Worked on toss height on 2nd serve today/)).toBeInTheDocument();
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
      <PlayerNotesSheet playerId="player-1" open={open} onOpenChange={setOpen} />
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
  const user = userEvent.setup();
  renderControlled();
  await screen.findByRole("heading", { name: "Notes" });

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
  const user = userEvent.setup();
  renderControlled();
  await screen.findByRole("heading", { name: "Notes" });

  await user.click(screen.getByRole("button", { name: "Quick note" }));
  await user.type(screen.getByPlaceholderText("What did you notice?"), "Half a thought");
  await user.click(screen.getByRole("button", { name: "Close" }));

  await user.click(screen.getByRole("button", { name: "Reopen notes" }));

  expect(await screen.findByRole("button", { name: "Quick note" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("What did you notice?")).not.toBeInTheDocument();
});
