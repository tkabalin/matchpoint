import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";

import { MatchSetupScreen } from "./match-setup-screen";
import type { MatchSetupConfig } from "./match-setup-screen";

function renderSetup(props: Partial<ComponentProps<typeof MatchSetupScreen>> = {}) {
  const onBack = vi.fn();
  const onStart = vi.fn<(config: MatchSetupConfig) => void>();
  render(<MatchSetupScreen playerName="Rivera" onBack={onBack} onStart={onStart} {...props} />);
  return { onBack, onStart, user: userEvent.setup({ delay: null }) };
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

test("the coach's saved defaults are what the form opens on", async () => {
  const { onStart, user } = renderSetup({
    defaultScoringSystem: "no_ad_scoring",
    defaultSurfaceType: "clay",
  });

  expect(screen.getByLabelText("Scoring system")).toHaveTextContent("No-Ad Scoring");
  expect(screen.getByLabelText("Court type")).toHaveTextContent("Clay");

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({ scoringSystem: "no_ad_scoring", surfaceType: "clay" }),
  );
});

// A coach who stepped back into setup picked these for this match, over a default that
// only says what they usually play.
test("what setup was left holding wins over the saved defaults", () => {
  renderSetup({
    defaultScoringSystem: "no_ad_scoring",
    defaultSurfaceType: "clay",
    initial: {
      opponentName: "Okoye",
      scoringSystem: "pro_set",
      surfaceType: "grass",
      playerServesFirst: true,
    },
  });

  expect(screen.getByLabelText("Scoring system")).toHaveTextContent("Pro Set");
  expect(screen.getByLabelText("Court type")).toHaveTextContent("Grass");
});

test("back steps out of setup", async () => {
  const { onBack, user } = renderSetup();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalled();
});
