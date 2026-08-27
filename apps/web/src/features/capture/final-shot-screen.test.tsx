import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { FinalShotScreen } from "./final-shot-screen";

function renderFinalShot() {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<FinalShotScreen onAction={onAction} />);
  return { onAction, user: userEvent.setup() };
}

test("offers every stored shot on both wings, and labels the columns", () => {
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
