import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { EndingScreen } from "./ending-screen";

// Real timers throughout, same reason as final-shot-screen.test.tsx: the exit zoom is a
// 480ms setTimeout, and faking it stalls user-event's own scheduling.

const ZOOM_TO = { left: 15.76, top: 6.2, width: 32.72, height: 19.73 };

function renderEnding(won: boolean) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(
    <EndingScreen
      won={won}
      zoomTo={ZOOM_TO}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onAction={onAction}
    />,
  );
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test("forced records the ending in one tap, with no exit zoom", async () => {
  const { onAction, user } = renderEnding(true);

  await user.click(screen.getByRole("button", { name: /^Forced/ }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_ENDING", endReason: "FORCED" });
});

test("unforced waits out the exit zoom before dispatching", async () => {
  const { onAction, user } = renderEnding(true);

  await user.click(screen.getByRole("button", { name: /^Unforced/ }));
  expect(onAction).not.toHaveBeenCalled();

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({ type: "TAP_ENDING", endReason: "MISTAKE" });
  });
});

test("an unforced tap zooms the court back out immediately, ahead of the dispatch it delays", async () => {
  const { user } = renderEnding(true);
  const zoomLayer = screen.getByTestId("zoom-layer");
  expect(zoomLayer).not.toHaveStyle({ width: "100%" });

  await user.click(screen.getByRole("button", { name: /^Unforced/ }));

  expect(zoomLayer).toHaveStyle({ width: "100%" });
});

test("a second tap during the exit zoom does not queue a second dispatch", async () => {
  const { onAction, user } = renderEnding(true);

  await user.click(screen.getByRole("button", { name: /^Unforced/ }));
  await user.click(screen.getByRole("button", { name: /^Forced/ }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  expect(onAction).toHaveBeenCalledWith({ type: "TAP_ENDING", endReason: "MISTAKE" });
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

// Unlike rally-length-screen.tsx (the flow's entry into the zoomed view), this screen
// is only ever reached already zoomed, so it renders straight into the target region —
// no local "starts full-court" state to settle out of.
test("renders already zoomed to the given region, with no entrance delay", () => {
  renderEnding(true);
  expect(screen.getByTestId("zoom-layer")).not.toHaveStyle({ width: "100%" });
});
