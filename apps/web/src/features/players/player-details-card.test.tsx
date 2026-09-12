import type { PlayerRead, PlayerSelfRead } from "@matchpoint/api-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { PlayerDetailsCard } from "./player-details-card";

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
