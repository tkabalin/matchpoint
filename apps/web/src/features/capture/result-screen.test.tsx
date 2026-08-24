import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Match } from "./match";
import { Point } from "./point";
import { ResultScreen } from "./result-screen";

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

let nextSequence = 0;

function pointWonBy(winner: string) {
  const sequence = nextSequence;
  nextSequence += 1;
  return Point.create({
    id: `point-${String(sequence)}`,
    matchId: MATCH_ID,
    timestamp: 1_700_000_000_000 + sequence,
    sequence,
    server: "TRACKED",
    courtSide: "DEUCE",
    serves: [{ number: 1, outcome: "IN", location: null }],
    returnOutcome: null,
    won: winner === TRACKED_ID,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    wing: "FOREHAND",
    shotType: "DRIVE",
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "DEEP" },
    rallyLengthBucket: "B2",
  });
}

/** Points enough to take `games` games, four points each. */
function gamesFor(winner: string, games: number) {
  return Array.from({ length: games * 4 }, () => pointWonBy(winner));
}

function renderResult(options: { match?: Match; points?: Point[] } = {}) {
  const onHome = vi.fn();
  const onViewResults = vi.fn();
  render(
    <ResultScreen
      match={options.match ?? matchWith()}
      points={options.points ?? []}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onHome={onHome}
      onViewResults={onViewResults}
    />,
  );
  return { onHome, onViewResults, user: userEvent.setup() };
}

test("a match won in straight sets reads as a win, with the score from its points", () => {
  // 6-0, 6-0 to the tracked player.
  const points = [...gamesFor(TRACKED_ID, 6), ...gamesFor(TRACKED_ID, 6)];
  renderResult({ points });

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText("Rivera d. Okoye — 6-0, 6-0")).toBeVisible();

  const score = screen.getByRole("table");
  expect(within(score).getByRole("columnheader", { name: "S1" })).toBeVisible();
  expect(within(score).getByRole("columnheader", { name: "S2" })).toBeVisible();
});

test("a lost match names the winner first and reads the score from their side", () => {
  const points = [...gamesFor(OPPONENT_ID, 6), ...gamesFor(OPPONENT_ID, 6)];
  renderResult({ points });

  expect(screen.getByRole("heading", { name: "Loss" })).toBeVisible();
  expect(screen.getByText("Okoye d. Rivera — 6-0, 6-0")).toBeVisible();
});

test("a retirement beats the set count and says so", () => {
  // The opponent leads on sets, but retired, so the tracked player takes it.
  const points = [...gamesFor(OPPONENT_ID, 6), ...gamesFor(OPPONENT_ID, 6)];
  const match = matchWith({
    outcomeOverride: { reason: "retirement", winner: TRACKED_ID },
  });
  renderResult({ match, points });

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText(/Rivera d\. Okoye .*retirement/)).toBeVisible();
});

test("a walkover with no points played drops the score, not just its numbers", () => {
  const match = matchWith({ outcomeOverride: { reason: "walkover", winner: TRACKED_ID } });
  renderResult({ match, points: [] });

  expect(screen.getByText("Rivera d. Okoye — walkover")).toBeVisible();
});

test("offers the way home and the way to the match's own results", async () => {
  const { onHome, onViewResults, user } = renderResult();

  await user.click(screen.getByRole("button", { name: "Home" }));
  expect(onHome).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Match results" }));
  expect(onViewResults).toHaveBeenCalledTimes(1);
});
