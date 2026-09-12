import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { EndingScreen } from "./ending-screen";

function renderEnding(won: boolean) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(
    <EndingScreen won={won} trackedPlayerName="Rivera" opponentName="Okoye" onAction={onAction} />,
  );
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test.each([
  [/^Forced/, "FORCED"],
  [/^Unforced/, "MISTAKE"],
])("%s records the ending in one tap", async (name, endReason) => {
  const { onAction, user } = renderEnding(true);

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_ENDING", endReason });
});

test("names the winner the final ball implied, so a wrong half is caught here", () => {
  renderEnding(true);
  expect(screen.getByText("Point to Rivera")).toBeVisible();
  expect(screen.getByRole("button", { name: /Okoye's mistake/ })).toBeVisible();
});

test("and the other way round when the ball finished on our half", () => {
  renderEnding(false);
  expect(screen.getByText("Point to Okoye")).toBeVisible();
  expect(screen.getByRole("button", { name: /Rivera's mistake/ })).toBeVisible();
});
