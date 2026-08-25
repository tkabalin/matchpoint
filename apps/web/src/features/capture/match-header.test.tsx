import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Match } from "./match";
import { MatchHeader } from "./match-header";
import { Point } from "./point";
import type { Server } from "./point";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

const match = Match.create({
  matchId: MATCH_ID,
  playedOn: "2026-08-23",
  trackedPlayerId: TRACKED_ID,
  opponentId: OPPONENT_ID,
  opponentName: null,
  scoringSystem: "traditional",
  firstServer: TRACKED_ID,
  surfaceType: "hard",
  outcomeOverride: null,
});

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
    rallyLengthBucket: null,
  });
}

function renderHeader(options: { points?: Point[]; server?: Server } = {}) {
  const handlers = {
    onBack: vi.fn(),
    onSkipPoint: vi.fn(),
    onSkipAhead: vi.fn(),
  };
  render(
    <MatchHeader
      match={match}
      points={options.points ?? []}
      server={options.server ?? "TRACKED"}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

test("marks the server of the point being captured", () => {
  renderHeader({ server: "OPPONENT" });

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByRole("rowheader", { name: "Rivera" })).toBeVisible();
  expect(within(score).getByRole("rowheader", { name: "Okoye, serving" })).toBeVisible();
});

test("shows the live game score from the recorded points", () => {
  // Two points to the tracked player, one to the opponent: 0-0 games, 30-15.
  const points = [pointWonBy(TRACKED_ID), pointWonBy(TRACKED_ID), pointWonBy(OPPONENT_ID)];
  renderHeader({ points });

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("30")).toBeVisible();
  expect(within(score).getByText("15")).toBeVisible();
});

test("sizes the score for the whole match before a point is played", () => {
  // Best-of-three: two completed sets, the live games, the current call.
  renderHeader();

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getAllByRole("cell")).toHaveLength(8);
});

test("keeps that width once sets have been played", () => {
  const points = [pointWonBy(TRACKED_ID), pointWonBy(OPPONENT_ID)];
  renderHeader({ points });

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getAllByRole("cell")).toHaveLength(8);
});

test("back greys out where there is nothing behind, rather than vanishing", async () => {
  const user = userEvent.setup();
  render(
    <MatchHeader
      match={match}
      points={[]}
      server="TRACKED"
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onBack={null}
      onSkipPoint={vi.fn()}
      onSkipAhead={vi.fn()}
    />,
  );

  const back = screen.getByRole("button", { name: "Back, nothing to go back to" });
  expect(back).toBeVisible();
  expect(back).toHaveAttribute("aria-disabled", "true");

  // Nothing to assert on the other side of the tap: it is that nothing happens.
  await user.click(back);
});

test("back steps the capture flow back", async () => {
  const { onBack, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalledTimes(1);
});

test("tapping skip asks who won before recording the point", async () => {
  const { onSkipPoint, onSkipAhead, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Skip point" }));

  expect(screen.getByRole("heading", { name: "Who won the point?" })).toBeVisible();
  expect(onSkipPoint).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: /Win/ }));

  expect(onSkipPoint).toHaveBeenCalledWith(true);
  expect(onSkipAhead).not.toHaveBeenCalled();
});

test("the skipped point can go to the opponent", async () => {
  const { onSkipPoint, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Loss/ }));

  expect(onSkipPoint).toHaveBeenCalledWith(false);
});

test("holding skip opens skip ahead instead of skipping the point", async () => {
  const { onSkipPoint, onSkipAhead, user } = renderHeader();
  const skip = screen.getByRole("button", { name: "Skip point" });

  await user.pointer({ keys: "[MouseLeft>]", target: skip });
  await waitFor(() => {
    expect(onSkipAhead).toHaveBeenCalledTimes(1);
  });
  await user.pointer({ keys: "[/MouseLeft]", target: skip });

  expect(onSkipPoint).not.toHaveBeenCalled();
});
