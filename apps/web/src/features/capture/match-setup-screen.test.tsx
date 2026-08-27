import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { MatchSetupScreen } from "./match-setup-screen";
import type { MatchSetupConfig } from "./match-setup-screen";

function renderSetup() {
  const onBack = vi.fn();
  const onStart = vi.fn<(config: MatchSetupConfig) => void>();
  render(<MatchSetupScreen playerName="Rivera" onBack={onBack} onStart={onStart} />);
  return { onBack, onStart, user: userEvent.setup() };
}

test("names the player the match is for", () => {
  renderSetup();

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();
  expect(screen.getByText("Rivera")).toBeVisible();
});

test("a match cannot start without an opponent", async () => {
  const { onStart, user } = renderSetup();

  expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");

  expect(screen.getByRole("button", { name: "Start match" })).toBeEnabled();
  expect(onStart).not.toHaveBeenCalled();
});

test("starting hands back everything the match needs", async () => {
  const { onStart, user } = renderSetup();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(onStart).toHaveBeenCalledWith({
    opponentName: "Okoye",
    scoringSystem: "traditional",
    surfaceType: "unspecified",
    playerServesFirst: true,
  });
});

test("the opponent can serve first", async () => {
  const { onStart, user } = renderSetup();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Opponent" }));
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ playerServesFirst: false }));
});

test("whitespace alone is not an opponent", async () => {
  const { user } = renderSetup();

  await user.type(screen.getByLabelText("Opponent"), "   ");

  expect(screen.getByRole("button", { name: "Start match" })).toBeDisabled();
});

test("back steps out of setup", async () => {
  const { onBack, user } = renderSetup();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalled();
});
