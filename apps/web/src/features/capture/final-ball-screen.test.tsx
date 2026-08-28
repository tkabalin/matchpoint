import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { FinalBallScreen } from "./final-ball-screen";

// Real timers: the court's flash is a 420ms setTimeout, same as court-diagram.test.tsx.

function renderFinalBall(won = true) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<FinalBallScreen won={won} onAction={onAction} />);
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test("offers the four zones players asked for", () => {
  renderFinalBall();

  for (const name of ["Deuce deep", "Deuce short", "Ad deep", "Ad short"]) {
    expect(screen.getByRole("button", { name })).toBeVisible();
  }
});

test.each([
  ["Deuce deep", "DEUCE", "DEEP"],
  ["Deuce short", "DEUCE", "SHORT"],
  ["Ad deep", "AD", "DEEP"],
  ["Ad short", "AD", "SHORT"],
])("%s records that zone, always as a ball that landed", async (name, half, depth) => {
  const { onAction, user } = renderFinalBall();

  await user.click(screen.getByRole("button", { name }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({
      type: "TAP_BALL_LOCATION",
      ballIn: true,
      location: { half, depth },
    });
  });
});

test("the zones sit in the half the ball landed in", () => {
  const { unmount } = render(<FinalBallScreen won onAction={vi.fn()} />);
  // Won: our player hit it, so it landed in the opponent's half, beyond the net.
  expect(screen.getByRole("button", { name: "Deuce deep" })).toHaveStyle({ top: "6.2%" });
  unmount();

  render(<FinalBallScreen won={false} onAction={vi.fn()} />);
  // Lost: the opponent hit it, so it landed in ours.
  expect(screen.getByRole("button", { name: "Deuce deep" })).toHaveStyle({ top: "71.76%" });
});
