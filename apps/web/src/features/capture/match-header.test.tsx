import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { Match } from "./match";
import { MatchHeader } from "./match-header";
import type { Server } from "./point";
import { applyPoint, initialBoard } from "./score";
import type { Scoreboard } from "./score";

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

/** A board with the given run of points already folded into it. */
function boardWith(wins: boolean[]): Scoreboard {
  return wins.reduce((board, won) => applyPoint(match, board, won), initialBoard(match));
}

function renderHeader(options: { board?: Scoreboard; server?: Server } = {}) {
  const handlers = {
    onBack: vi.fn(),
    onSkipPoint: vi.fn(),
    onEditScore: vi.fn(),
    onAddNote: vi.fn(),
  };
  render(
    <MatchHeader
      match={match}
      board={options.board ?? initialBoard(match)}
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

test("shows the live game score from the folded board", () => {
  // Two points to the tracked player, one to the opponent: 0-0 games, 30-15.
  renderHeader({ board: boardWith([true, true, false]) });

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
  renderHeader({ board: boardWith([true, false]) });

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getAllByRole("cell")).toHaveLength(8);
});

test("back greys out where there is nothing behind, rather than vanishing", async () => {
  const user = userEvent.setup();
  render(
    <MatchHeader
      match={match}
      board={initialBoard(match)}
      server="TRACKED"
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onBack={null}
      onSkipPoint={vi.fn()}
      onEditScore={vi.fn()}
      onAddNote={vi.fn()}
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
  const { onSkipPoint, onEditScore, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Skip point" }));

  expect(screen.getByRole("heading", { name: "Who won the point?" })).toBeVisible();
  expect(onSkipPoint).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: /Win/ }));

  expect(onSkipPoint).toHaveBeenCalledWith(true);
  expect(onEditScore).not.toHaveBeenCalled();
});

test("the skipped point can go to the opponent", async () => {
  const { onSkipPoint, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Loss/ }));

  expect(onSkipPoint).toHaveBeenCalledWith(false);
});

test("holding skip opens the score editor instead of skipping the point", async () => {
  const { onSkipPoint, onEditScore, user } = renderHeader();
  const skip = screen.getByRole("button", { name: "Skip point" });

  // The button stays held past HOLD_MS before it's released: onEditScore only fires
  // on the release, not mid-hold (see match-header.tsx's onClick comment for why).
  await user.pointer({ keys: "[MouseLeft>]", target: skip });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(onEditScore).not.toHaveBeenCalled();
  await user.pointer({ keys: "[/MouseLeft]", target: skip });

  expect(onEditScore).toHaveBeenCalledTimes(1);
  expect(onSkipPoint).not.toHaveBeenCalled();
});

test("a long-press's swallowed click doesn't leave a keyboard activation stuck", async () => {
  const { onSkipPoint, onEditScore, user } = renderHeader();
  const skip = screen.getByRole("button", { name: "Skip point" });

  // The sheet a long-press opens swallows the click the release would have produced,
  // so nothing consumes the hold flag. A later tap resets it on its own pointerdown;
  // a keyboard activation has no pointerdown, so it was the one left stuck.
  await user.pointer({ keys: "[MouseRight]", target: skip });
  expect(onEditScore).toHaveBeenCalledTimes(1);

  skip.focus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { name: "Who won the point?" })).toBeVisible();
  expect(onSkipPoint).not.toHaveBeenCalled();
  expect(onEditScore).toHaveBeenCalledTimes(1);
});

test("tapping the score opens the editor — the most discoverable way in", async () => {
  const { onEditScore, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Edit score" }));

  expect(onEditScore).toHaveBeenCalledTimes(1);
});

test("a set the coach declared rather than watched says so", () => {
  const fresh = boardWith([]);
  const declared =
    fresh.currentSet === null
      ? fresh
      : { ...fresh, currentSet: { ...fresh.currentSet, slotsPlayed: 4, slotsObserved: 0 } };
  renderHeader({ board: declared });

  // One per player row: the column belongs to both of them.
  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getAllByText("(not fully recorded)")).toHaveLength(2);
});

test("tapping the note button opens the text sheet where the browser can't transcribe, and adds the note", async () => {
  // jsdom implements no SpeechRecognition, same fallback path a real browser without
  // it takes — see note-button.tsx.
  const { onAddNote, user } = renderHeader();

  await user.click(screen.getByRole("button", { name: "Add a note" }));
  await user.type(screen.getByPlaceholderText("What happened?"), "favoring the backhand today");
  await user.click(screen.getByRole("button", { name: "Add note" }));

  expect(onAddNote).toHaveBeenCalledWith("favoring the backhand today");
});
