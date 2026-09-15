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

test("says which fields are required and which can be left alone", () => {
  renderSetup();

  expect(screen.getAllByText("(required)")).toHaveLength(1);
  expect(screen.getAllByText("(optional)")).toHaveLength(1);
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
    event: null,
    scoringSystem: "traditional",
    surfaceType: "unspecified",
    playerServesFirst: true,
  });
});

test("an event name is passed through, trimmed", async () => {
  const { onStart, user } = renderSetup();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.type(screen.getByLabelText("Event"), "  Regional Open  ");
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ event: "Regional Open" }));
});

test("an event left blank is null, not an empty string — it never blocks starting", async () => {
  const { onStart, user } = renderSetup();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ event: null }));
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
      event: "Regional Open",
      scoringSystem: "pro_set",
      surfaceType: "grass",
      playerServesFirst: true,
    },
  });

  expect(screen.getByLabelText("Scoring system")).toHaveTextContent("Pro Set");
  expect(screen.getByLabelText("Court type")).toHaveTextContent("Grass");
  expect(screen.getByLabelText("Event")).toHaveValue("Regional Open");
});

test("offers previous opponents as suggestions on the Opponent field", async () => {
  const { user } = renderSetup({ previousOpponents: ["Okoye", "Zulu"] });

  await user.click(screen.getByLabelText("Opponent"));

  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Okoye",
    "Zulu",
  ]);
});

test("typing narrows the suggestions to matching opponents", async () => {
  const { user } = renderSetup({ previousOpponents: ["Okoye", "Zulu"] });

  await user.type(screen.getByLabelText("Opponent"), "zu");

  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Zulu"]);
});

test("selecting a suggestion fills the field and closes the list", async () => {
  const { user } = renderSetup({ previousOpponents: ["Okoye", "Zulu"] });

  await user.click(screen.getByLabelText("Opponent"));
  await user.click(screen.getByRole("option", { name: "Zulu" }));

  expect(screen.getByLabelText("Opponent")).toHaveValue("Zulu");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("no previous opponents means there's nothing to open", async () => {
  const { user } = renderSetup();

  await user.click(screen.getByLabelText("Opponent"));

  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("back steps out of setup", async () => {
  const { onBack, user } = renderSetup();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalled();
});
