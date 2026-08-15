import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PlayerAvatar } from "./player-avatar";

test("renders the player's initials", () => {
  render(<PlayerAvatar player={{ id: "1", first_name: "Amahle", last_name: "Nkosi" }} />);

  expect(screen.getByText("AN")).toBeInTheDocument();
});

test("picks the same color for the same id", () => {
  const player = { id: "3f1c2b4e-0000-4000-8000-000000000001", first_name: "A", last_name: "B" };

  const { container: first } = render(<PlayerAvatar player={player} />);
  const { container: second } = render(<PlayerAvatar player={player} />);

  expect(first.firstElementChild?.getAttribute("style")).toEqual(
    second.firstElementChild?.getAttribute("style"),
  );
});
