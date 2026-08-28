import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { createMatch } from "./match";
import type { ScoringSystem } from "./match";
import { applyPoint, initialBoard } from "./score";
import type { Scoreboard } from "./score";
import { ScoreSheet } from "./score-sheet";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

function matchOf(scoringSystem: ScoringSystem = "traditional") {
  return createMatch(
    "2026-08-27",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    TRACKED_ID,
    scoringSystem,
    "unspecified",
    null,
  );
}

function renderSheet(
  options: {
    scoringSystem?: ScoringSystem;
    wins?: boolean[];
    hasEvents?: boolean;
  } = {},
) {
  const match = matchOf(options.scoringSystem);
  const board: Scoreboard = (options.wins ?? []).reduce(
    (current, won) => applyPoint(match, current, won),
    initialBoard(match),
  );
  const onSetScore = vi.fn();
  const onEndMatch = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ScoreSheet
      match={match}
      board={board}
      hasEvents={options.hasEvents ?? (options.wins ?? []).length > 0}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onSetScore={onSetScore}
      onEndMatch={onEndMatch}
      onDismiss={onDismiss}
    />,
  );
  return { match, onSetScore, onEndMatch, onDismiss, user: userEvent.setup({ delay: null }) };
}

/** `count` clean games to one side. */
function games(trackedWins: boolean, count: number): boolean[] {
  return Array.from({ length: count * 4 }, () => trackedWins);
}

function alternating(count: number): boolean[] {
  return Array.from({ length: count }, (_, index) => games(index % 2 === 0, 1)).flat();
}

async function setGames(
  user: ReturnType<typeof renderSheet>["user"],
  name: string,
  setNumber: number,
  value: string,
) {
  const field = screen.getByLabelText(`${name} set ${String(setNumber)} games`);
  await user.clear(field);
  await user.type(field, value);
}

test("opens pre-filled from the board, so a correction only touches what is wrong", () => {
  renderSheet({ wins: [...games(true, 3), ...games(false, 2), true] });

  expect(screen.getByLabelText("Rivera set 1 games")).toHaveValue(3);
  expect(screen.getByLabelText("Okoye set 1 games")).toHaveValue(2);
  expect(screen.getByRole("button", { name: "Rivera 15" })).toHaveAttribute("aria-pressed", "true");
});

test("a set each, the opponent taking the first, is enterable", async () => {
  const { onSetScore, user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, "4");
  await setGames(user, "Okoye", 1, "6");
  await setGames(user, "Rivera", 2, "6");
  await setGames(user, "Okoye", 2, "3");
  await setGames(user, "Rivera", 3, "1");
  await setGames(user, "Okoye", 3, "0");
  await user.click(screen.getByRole("button", { name: "Set score" }));

  expect(onSetScore).toHaveBeenCalledTimes(1);
  expect(onSetScore.mock.calls[0]?.[0].after.sets).toEqual([
    { tracked: 4, opponent: 6, tiebreak: null },
    { tracked: 6, opponent: 3, tiebreak: null },
    { tracked: 1, opponent: 0, tiebreak: null },
  ]);
});

test("a breaker row appears at the boundary, and its score is optional", async () => {
  const { onSetScore, user } = renderSheet({ hasEvents: false });

  expect(screen.queryByLabelText("Rivera set 1 tiebreak points")).not.toBeInTheDocument();

  await setGames(user, "Rivera", 1, "7");
  await setGames(user, "Okoye", 1, "6");
  expect(screen.getByLabelText("Rivera set 1 tiebreak points")).toBeVisible();

  // Left blank, the set still records as a 7-6 win.
  await user.click(screen.getByRole("button", { name: "Set score" }));
  expect(onSetScore.mock.calls[0]?.[0].after.sets[0]).toEqual({
    tracked: 7,
    opponent: 6,
    tiebreak: null,
  });
});

test("a 7-6 can carry the breaker score it was won on", async () => {
  const { onSetScore, user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, "7");
  await setGames(user, "Okoye", 1, "6");
  await user.type(screen.getByLabelText("Rivera set 1 tiebreak points"), "7");
  await user.type(screen.getByLabelText("Okoye set 1 tiebreak points"), "5");
  await user.click(screen.getByRole("button", { name: "Set score" }));

  expect(onSetScore.mock.calls[0]?.[0].after.sets[0]).toEqual({
    tracked: 7,
    opponent: 6,
    tiebreak: { tracked: 7, opponent: 5 },
  });
});

test("a breaker in progress replaces the game chips with its points", async () => {
  const { user } = renderSheet({ wins: alternating(12) });

  expect(screen.queryByRole("group", { name: "Current game" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Rivera set 1 tiebreak points"), "3");
  await user.type(screen.getByLabelText("Okoye set 1 tiebreak points"), "2");

  // Five breaker points in, the serve has moved on — the cross-check knows that too.
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  expect(screen.getByRole("button", { name: "Set score" })).toBeEnabled();
});

test("no-ad scoring offers no advantage chip", () => {
  renderSheet({ scoringSystem: "no_ad_scoring" });

  expect(screen.getByRole("button", { name: "Rivera 40" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Rivera AD" })).not.toBeInTheDocument();
});

test("advantage is offered where the format plays it, and stands against the other's 40", async () => {
  const { onSetScore, user } = renderSheet({ hasEvents: false });

  await user.click(screen.getByRole("button", { name: "Okoye 40" }));
  await user.click(screen.getByRole("button", { name: "Rivera AD" }));
  await setGames(user, "Rivera", 1, "1");
  await user.click(screen.getByRole("button", { name: "Set score" }));

  expect(onSetScore.mock.calls[0]?.[0].after.game).toEqual({ tracked: 4, opponent: 3 });
});

test("the match-tiebreak decider shows a breaker and no games", async () => {
  const { user } = renderSheet({ scoringSystem: "match_tiebreak_10_points", hasEvents: false });

  await setGames(user, "Rivera", 1, "6");
  await setGames(user, "Okoye", 1, "0");
  await setGames(user, "Rivera", 2, "0");
  await setGames(user, "Okoye", 2, "6");
  await setGames(user, "Rivera", 3, "0");
  await setGames(user, "Okoye", 3, "0");

  expect(screen.getByLabelText("Rivera set 3 tiebreak points")).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeEnabled();
});

test("legacy's decider is labelled as playing no tiebreak, and takes an 8-6", async () => {
  const { onSetScore, user } = renderSheet({ scoringSystem: "legacy", hasEvents: false });

  await setGames(user, "Rivera", 1, "6");
  await setGames(user, "Okoye", 1, "0");
  await setGames(user, "Rivera", 2, "0");
  await setGames(user, "Okoye", 2, "6");
  await setGames(user, "Rivera", 3, "8");
  await setGames(user, "Okoye", 3, "6");

  expect(screen.getByText("Set (no TB)")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Set score" }));
  expect(onSetScore.mock.calls[0]?.[0].after.sets[2]).toEqual({
    tracked: 8,
    opponent: 6,
    tiebreak: null,
  });
});

test("a refusal names the cell it belongs to, and holds the button", async () => {
  const { user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, "7");
  await setGames(user, "Okoye", 1, "4");

  expect(screen.getByText("That set score can't happen.")).toBeVisible();
  expect(screen.getByLabelText("Rivera set 1 games")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();
});

test.each(["1.5", "-1"])("survives %s typed into a cell, refusing it per cell", async (typed) => {
  const { user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, typed);

  // The editor is still standing, which is the point: the checkpoint class refuses
  // this input by throwing, so it must not be built while the coach is still typing.
  expect(screen.getByRole("heading", { name: "Score" })).toBeVisible();
  expect(screen.getByText("Games must be whole numbers from 0 to 99.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();
});

test("a fractional tiebreak score is refused the same way", async () => {
  const { user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, "7");
  await setGames(user, "Okoye", 1, "6");
  await user.type(screen.getByLabelText("Rivera set 1 tiebreak points"), "2.5");

  expect(screen.getByRole("heading", { name: "Score" })).toBeVisible();
  expect(screen.getByText("Tiebreak points must be whole numbers.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();
});

test("a score that changes nothing is refused", () => {
  renderSheet({ wins: games(true, 2) });

  expect(screen.getByText("That's already the score.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();
});

test("on an empty log the serving answer pins who served first, and says so", async () => {
  const { onSetScore, user } = renderSheet({ hasEvents: false });

  await setGames(user, "Rivera", 1, "4");
  await setGames(user, "Okoye", 1, "2");
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));

  expect(screen.getByText("So Okoye served first.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Set score" }));
  expect(onSetScore.mock.calls[0]?.[0].servesNext).toBe("OPPONENT");
});

test("with points already recorded, a disagreeing answer names both causes", async () => {
  const { user } = renderSheet({ wins: games(true, 1) });

  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Rivera" }));

  expect(
    screen.getByText(/Either the games are off, or the serving order changed on court/),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();
});

test("the order-changed escape records the deviation rather than refusing it", async () => {
  const { onSetScore, user } = renderSheet({ wins: games(true, 1) });

  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Rivera" }));
  await user.click(screen.getByRole("button", { name: "The order changed on court" }));

  expect(screen.getByText("Recorded as a change of serving order from here on.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Set score" }));
  expect(onSetScore.mock.calls[0]?.[0]).toMatchObject({
    servesNext: "TRACKED",
    orderChanged: true,
  });
});

test("ending the match still asks why and who won", async () => {
  const { onEndMatch, user } = renderSheet();

  await user.click(screen.getByRole("button", { name: "End match" }));
  await user.click(screen.getByRole("radio", { name: /Retirement/ }));
  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Rivera" }));
  await user.click(screen.getByRole("button", { name: "Confirm end of match" }));

  expect(onEndMatch).toHaveBeenCalledWith({ reason: "retirement", trackedPlayerWon: true });
});
