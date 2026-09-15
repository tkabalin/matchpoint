import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Match } from "./match";
import { ResultScreen } from "./result-screen";
import { applyPoint, initialBoard } from "./score";
import type { Scoreboard } from "./score";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

function matchWith(overrides: Record<string, unknown> = {}) {
  return Match.create({
    matchId: MATCH_ID,
    playedOn: "2026-08-24",
    trackedPlayerId: TRACKED_ID,
    opponentId: OPPONENT_ID,
    opponentName: null,
    scoringSystem: "traditional",
    firstServer: TRACKED_ID,
    surfaceType: "hard",
    outcomeOverride: null,
    ...overrides,
  });
}

/** A board with the given run of points folded in, tracked-player-wins-first. */
function boardWith(match: Match, wins: boolean[]): Scoreboard {
  return wins.reduce((board, won) => applyPoint(match, board, won), initialBoard(match));
}

/** `games` clean games to one side. */
function gamesFor(trackedWins: boolean, games: number): boolean[] {
  return Array.from({ length: games * 4 }, () => trackedWins);
}

function renderResult(options: { match?: Match; wins?: boolean[]; onUndo?: () => void } = {}) {
  const match = options.match ?? matchWith();
  const onHome = vi.fn();
  const onViewResults = vi.fn();
  const onFinish = vi.fn();
  render(
    <ResultScreen
      match={match}
      board={boardWith(match, options.wins ?? [])}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onUndo={options.onUndo ?? null}
      onFinish={onFinish}
      onHome={onHome}
      onViewResults={onViewResults}
    />,
  );
  return { onHome, onViewResults, onFinish, user: userEvent.setup({ delay: null }) };
}

test("a match won in straight sets reads as a win, with the score from its points", () => {
  // 6-0, 6-0 to the tracked player.
  renderResult({ wins: [...gamesFor(true, 6), ...gamesFor(true, 6)] });

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText("Rivera d. Okoye 6-0, 6-0")).toBeVisible();

  const score = screen.getByRole("table");
  expect(within(score).getByRole("columnheader", { name: "S1" })).toBeVisible();
  expect(within(score).getByRole("columnheader", { name: "S2" })).toBeVisible();
});

test("a lost match names the winner first and reads the score from their side", () => {
  renderResult({ wins: [...gamesFor(false, 6), ...gamesFor(false, 6)] });

  expect(screen.getByRole("heading", { name: "Loss" })).toBeVisible();
  expect(screen.getByText("Okoye d. Rivera 6-0, 6-0")).toBeVisible();
});

test("a retirement beats the set count and says so", () => {
  // The opponent leads on sets, but retired, so the tracked player takes it.
  const match = matchWith({
    outcomeOverride: { reason: "retirement", winner: TRACKED_ID },
  });
  renderResult({ match, wins: [...gamesFor(false, 6), ...gamesFor(false, 6)] });

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText(/Rivera d\. Okoye .*retirement/)).toBeVisible();
});

test("a walkover with no points played drops the score, not just its numbers", () => {
  const match = matchWith({ outcomeOverride: { reason: "walkover", winner: TRACKED_ID } });
  renderResult({ match });

  expect(screen.getByText("Rivera d. Okoye (walkover)")).toBeVisible();
});

test("reports coverage in games, so a filled-in set never reads as watched", () => {
  const match = matchWith();
  renderResult({ match, wins: [...gamesFor(true, 6), ...gamesFor(true, 6)] });

  expect(screen.getByText("All 12 games recorded.")).toBeVisible();
});

test("offers to undo the last point only while there is one to take back", async () => {
  const onUndo = vi.fn();
  const { user } = renderResult({ onUndo, wins: [...gamesFor(true, 6), ...gamesFor(true, 6)] });

  await user.click(screen.getByRole("button", { name: "Undo last point" }));
  expect(onUndo).toHaveBeenCalledTimes(1);
});

test("no undo is offered when there is nothing to unwind", () => {
  renderResult();
  expect(screen.queryByRole("button", { name: "Undo last point" })).not.toBeInTheDocument();
});

test("finishing the match is its own explicit action", async () => {
  const { onFinish, user } = renderResult();

  await user.click(screen.getByRole("button", { name: "Finish match" }));

  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("offers the way home and the way to the match's own results", async () => {
  const { onHome, onViewResults, user } = renderResult();

  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Match results" }));
  expect(onViewResults).toHaveBeenCalledTimes(1);
});
