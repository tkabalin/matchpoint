import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { FinalShotScreen } from "./final-shot-screen";

const ZOOM_TO = { left: 15.76, top: 6.2, width: 32.72, height: 19.73 };

function renderFinalShot() {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<FinalShotScreen zoomTo={ZOOM_TO} onAction={onAction} />);
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test("offers every stored shot on both wings, and labels the columns once each", () => {
  renderFinalShot();

  // Eight shots, plus the one escape for a shot the coach didn't see.
  expect(screen.getAllByRole("button")).toHaveLength(9);
  expect(screen.getByText("Backhand")).toBeVisible();
  expect(screen.getByText("Forehand")).toBeVisible();
});

test.each([
  ["Backhand drive", "BACKHAND", "DRIVE"],
  ["Forehand drive", "FOREHAND", "DRIVE"],
  ["Backhand volley", "BACKHAND", "VOLLEY"],
  ["Forehand drop shot", "FOREHAND", "DROPSHOT"],
  ["Backhand lob", "BACKHAND", "LOB"],
  ["Forehand lob", "FOREHAND", "LOB"],
])("%s records that wing and shot type", async (name, wing, shotType) => {
  const { onAction, user } = renderFinalShot();

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_SHOT_DETAIL", wing, shotType });
});

// Reached only after rally length and ending have already zoomed in, so this screen
// renders straight into the target region rather than animating there itself.
test("renders already zoomed to the given region, with no entrance delay", () => {
  renderFinalShot();
  expect(screen.getByTestId("court-surface").style.transform).not.toBe("");
});
