import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { createMatch } from "./match";
import { SkipAheadSheet } from "./skip-ahead-sheet";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

// No real points recorded yet — every score entered in these tests is reachable from
// scratch, same as skip-ahead.ts's own "starting from nothing real" test group.
function renderSheet() {
  const match = createMatch("2026-08-24", TRACKED_ID, { opponentId: OPPONENT_ID }, TRACKED_ID);
  const onSkipToScore = vi.fn();
  const onEndMatch = vi.fn();
  const onDismiss = vi.fn();
  render(
    <SkipAheadSheet
      match={match}
      points={[]}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onSkipToScore={onSkipToScore}
      onEndMatch={onEndMatch}
      onDismiss={onDismiss}
    />,
  );
  return { onSkipToScore, onEndMatch, onDismiss, user: userEvent.setup() };
}

test("hands back the score the coach entered", async () => {
  const { onSkipToScore, user } = renderSheet();

  // 6 games total keeps "tracked serves next" (the sheet's default) consistent with
  // firstServer, so this only exercises entering a score, not the serving-next check.
  await user.clear(screen.getByLabelText("Rivera games"));
  await user.type(screen.getByLabelText("Rivera games"), "4");
  await user.clear(screen.getByLabelText("Okoye games"));
  await user.type(screen.getByLabelText("Okoye games"), "2");
  await user.click(screen.getByRole("button", { name: "Skip to score" }));

  expect(onSkipToScore).toHaveBeenCalledWith({
    trackedGames: 4,
    opponentGames: 2,
    trackedPoints: "0",
    opponentPoints: "0",
    trackedServesNext: true,
  });
});

test("the opponent can be the one serving next", async () => {
  const { onSkipToScore, user } = renderSheet();

  // One game played puts serve with the opponent, so this is where "Okoye" agrees
  // with firstServer rather than contradicting it.
  await user.clear(screen.getByLabelText("Rivera games"));
  await user.type(screen.getByLabelText("Rivera games"), "1");
  const serving = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(serving).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Skip to score" }));

  expect(onSkipToScore).toHaveBeenCalledWith(expect.objectContaining({ trackedServesNext: false }));
});

test("a serving-next answer that disagrees with firstServer is rejected, not silently applied", async () => {
  const { onSkipToScore, user } = renderSheet();

  // 0 games played, so serve is still firstServer's (Rivera) — picking Okoye
  // contradicts that. firstServer is fixed at match creation and never rewritten
  // here (see skip-ahead.ts), so this must be refused, not used to move it.
  const serving = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(serving).getByRole("button", { name: "Okoye" }));

  expect(screen.getByText(/doesn't match the score entered/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Skip to score" })).toBeDisabled();
  expect(onSkipToScore).not.toHaveBeenCalled();
});

test("a score that cannot exist says why, and cannot be applied", async () => {
  const { onSkipToScore, user } = renderSheet();

  await user.clear(screen.getByLabelText("Rivera games"));
  await user.type(screen.getByLabelText("Rivera games"), "150");

  expect(screen.getByText(/whole number between 0 and 99/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Skip to score" })).toBeDisabled();
  expect(onSkipToScore).not.toHaveBeenCalled();
});

test("ending the match is behind its own step, not offered outright", async () => {
  const { user } = renderSheet();

  expect(screen.queryByRole("radio")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "End match" }));

  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.getByRole("radio", { name: /Retirement/ })).toBeVisible();
});

test("ending the match needs both a reason and a winner", async () => {
  const { onEndMatch, user } = renderSheet();

  await user.click(screen.getByRole("button", { name: "End match" }));
  const confirm = screen.getByRole("button", { name: "Confirm end of match" });
  expect(confirm).toBeDisabled();

  await user.click(screen.getByRole("radio", { name: /Retirement/ }));
  expect(confirm).toBeDisabled();

  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Rivera" }));
  expect(confirm).toBeEnabled();

  await user.click(confirm);
  expect(onEndMatch).toHaveBeenCalledWith({ reason: "retirement", trackedPlayerWon: true });
});

test("cancelling closes without touching the match", async () => {
  const { onDismiss, onSkipToScore, onEndMatch, user } = renderSheet();

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onSkipToScore).not.toHaveBeenCalled();
  expect(onEndMatch).not.toHaveBeenCalled();
});
