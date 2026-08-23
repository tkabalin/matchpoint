import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

test("lists the player's tagged notes", async () => {
  renderSheet();

  expect(await screen.findByRole("heading", { name: "Notes" })).toBeInTheDocument();
  expect(await screen.findByText(/Worked on toss height on 2nd serve today/)).toBeInTheDocument();
  expect(screen.getByText("technical")).toBeInTheDocument();
});

test("renders nothing when the sheet is closed", () => {
  renderSheet(false);

  expect(screen.queryByRole("heading", { name: "Notes" })).not.toBeInTheDocument();
});
