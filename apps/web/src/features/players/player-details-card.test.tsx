import type { PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerDetailsCard } from "./player-details-card";

// clampNoteTo below spies on HTMLElement.prototype, which outlives the test that
// set it up: this config doesn't restore mocks between them.
afterEach(() => {
  vi.restoreAllMocks();
});

const BASE_PLAYER: PlayerRead = {
  id: "player-1",
  first_name: "Amahle",
  last_name: "Nkosi",
  username: "nksama001",
  date_of_birth: "2008-04-12",
  dominant_hand: "right",
  gender: "female",
  notes: "Strong two-handed backhand.",
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

test("shows date of birth, dominant hand and notes", () => {
  render(<PlayerDetailsCard player={BASE_PLAYER} onEdit={() => {}} />);

  expect(screen.getByText("Player details")).toBeInTheDocument();
  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  expect(screen.getByText("Strong two-handed backhand.")).toBeInTheDocument();
});

test("shows a dash for every field the player hasn't filled in", () => {
  render(
    <PlayerDetailsCard
      player={{ ...BASE_PLAYER, date_of_birth: null, dominant_hand: null, notes: null }}
      onEdit={() => {}}
    />,
  );

  expect(screen.getAllByText("—")).toHaveLength(3);
});

test("Edit lives in this card and fires the handler", async () => {
  const onEdit = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<PlayerDetailsCard player={BASE_PLAYER} onEdit={onEdit} />);

  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(onEdit).toHaveBeenCalledOnce();
});

// #203: a player viewing their own details gets PlayerSelfRead (no `notes` — coach
// notes are deliberately private) and no edit action (editing is coach-only).
test("shows a player's own details with no Edit button and no Notes row", () => {
  render(<PlayerDetailsCard player={SELF_PLAYER} />);

  expect(screen.getByText("Apr 12, 2008")).toBeInTheDocument();
  expect(screen.getByText("right")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByText("Notes")).not.toBeInTheDocument();
});

// A note runs to 2000 characters on a half-width card, so it clamps to four lines
// with the rest behind a toggle. jsdom lays nothing out, so the overflow the
// component measures has to be stated here.
function clampNoteTo(lines: number) {
  const lineHeight = 16;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(4 * lineHeight);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(lines * lineHeight);
}

test("a long note collapses, and Show more reveals the whole of it", async () => {
  clampNoteTo(9);
  const user = userEvent.setup({ delay: null });
  const notes = "Serves wide on the ad court whenever the score is tight. ".repeat(20);
  render(<PlayerDetailsCard player={{ ...BASE_PLAYER, notes }} onEdit={() => {}} />);

  expect(screen.getByText(/Serves wide on the ad court/)).toHaveClass("line-clamp-4");

  await user.click(screen.getByRole("button", { name: "Show more" }));

  expect(screen.getByText(/Serves wide on the ad court/)).not.toHaveClass("line-clamp-4");
  expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
});

test("a note that already fits gets no toggle", () => {
  clampNoteTo(1);
  render(<PlayerDetailsCard player={BASE_PLAYER} onEdit={() => {}} />);

  expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
});
