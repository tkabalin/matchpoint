import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { FinalBallScreen } from "./final-ball-screen";

// Real timers: the court's flash is a 420ms setTimeout, same as court-diagram.test.tsx.

function renderFinalBall() {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<FinalBallScreen trackedPlayerName="Rivera" opponentName="Okoye" onAction={onAction} />);
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test("offers the four zones on each player's half, and names whose half is whose", () => {
  renderFinalBall();

  for (const owner of ["Okoye", "Rivera"]) {
    for (const zone of ["deuce deep", "deuce short", "ad deep", "ad short"]) {
      expect(screen.getByRole("button", { name: `${owner}: ${zone}` })).toBeVisible();
    }
  }
  expect(screen.getByText("Okoye")).toBeVisible();
  expect(screen.getByText("Rivera")).toBeVisible();
});

// A ball finishing on the opponent's half was our player's last good ball, and vice
// versa — every zone must carry the right winner, not just one per half.
test.each([
  ["Okoye: deuce deep", true, "DEUCE", "DEEP"],
  ["Okoye: deuce short", true, "DEUCE", "SHORT"],
  ["Okoye: ad deep", true, "AD", "DEEP"],
  ["Okoye: ad short", true, "AD", "SHORT"],
  ["Rivera: deuce deep", false, "DEUCE", "DEEP"],
  ["Rivera: deuce short", false, "DEUCE", "SHORT"],
  ["Rivera: ad deep", false, "AD", "DEEP"],
  ["Rivera: ad short", false, "AD", "SHORT"],
])(
  "%s records that zone and the winner, always as a ball that landed",
  async (name, won, half, depth) => {
    const { onAction, user } = renderFinalBall();

    await user.click(screen.getByRole("button", { name }));

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith({
        type: "TAP_BALL_LOCATION",
        won,
        ballIn: true,
        location: { half, depth },
      });
    });
  },
);

test("the opponent's half is beyond the net and ours this side, never flipped", () => {
  renderFinalBall();

  expect(screen.getByRole("button", { name: "Okoye: deuce deep" })).toHaveStyle({ top: "6.2%" });
  expect(screen.getByRole("button", { name: "Rivera: deuce deep" })).toHaveStyle({
    top: "71.76%",
  });
});

test("deuce is to the right of whoever stands on that half", () => {
  renderFinalBall();

  // Far half faces us, so its deuce court is on our left; the near half's is on our right.
  expect(screen.getByRole("button", { name: "Okoye: deuce deep" })).toHaveStyle({
    left: "15.76%",
  });
  expect(screen.getByRole("button", { name: "Rivera: deuce deep" })).toHaveStyle({
    left: "48.48%",
  });
});

test("an unusual ending hands off to the flow's own unusual path", async () => {
  const { onAction, user } = renderFinalBall();

  await user.click(screen.getByRole("button", { name: "Unusual end" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_UNUSUAL" });
});

test("a let replays the point from the first serve", async () => {
  const { onAction, user } = renderFinalBall();

  await user.click(screen.getByRole("button", { name: "Let" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_LET" });
});

test("didn't see still asks who won, then records the point with its ending unknown", async () => {
  const { onAction, user } = renderFinalBall();

  await user.click(screen.getByRole("button", { name: "Didn't see" }));
  await user.click(screen.getByRole("button", { name: /Loss/ }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_DIDNT_SEE", won: false });
});
