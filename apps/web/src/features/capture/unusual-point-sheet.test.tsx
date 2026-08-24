import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction, CaptureStep } from "./capture-flow";
import { UnusualPointSheet } from "./unusual-point-sheet";

const OUTCOME_STEP: Extract<CaptureStep, { name: "UNUSUAL_OUTCOME" }> = { name: "UNUSUAL_OUTCOME" };
const REASON_STEP: Extract<CaptureStep, { name: "UNUSUAL_REASON" }> = { name: "UNUSUAL_REASON" };

function renderSheet(step: typeof OUTCOME_STEP | typeof REASON_STEP = OUTCOME_STEP) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  const onDismiss = vi.fn();
  render(
    <UnusualPointSheet
      step={step}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
      onAction={onAction}
      onDismiss={onDismiss}
    />,
  );
  return { onAction, onDismiss, user: userEvent.setup() };
}

test("asks who won first, naming both players", () => {
  renderSheet();

  expect(screen.getByRole("button", { name: /Win.*Rivera/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Loss.*Okoye/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "Record point" })).toBeDisabled();
});

test.each([
  [/Win.*Rivera/, true],
  [/Loss.*Okoye/, false],
])("%s awards the point", async (name, won) => {
  const { onAction, user } = renderSheet();

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_UNUSUAL_OUTCOME", won });
});

test("cancelling on the first step leaves the flow alone", async () => {
  const { onAction, onDismiss, user } = renderSheet();

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onAction).not.toHaveBeenCalled();
});

test("offers every stored reason once the winner is known", () => {
  renderSheet(REASON_STEP);

  expect(screen.getAllByRole("radio")).toHaveLength(7);
  expect(screen.getByRole("radio", { name: /Touched the net/ })).toBeVisible();
  expect(screen.getByRole("radio", { name: /Other/ })).toBeVisible();
});

test("the point cannot be recorded until a reason is picked", async () => {
  const { onAction, user } = renderSheet(REASON_STEP);

  expect(screen.getByRole("button", { name: "Record point" })).toBeDisabled();

  await user.click(screen.getByRole("radio", { name: /Hindrance/ }));

  expect(screen.getByRole("radio", { name: /Hindrance/ })).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByRole("button", { name: "Record point" }));

  expect(onAction).toHaveBeenCalledWith({
    type: "TAP_UNUSUAL_REASON",
    reason: "HINDRANCE",
    note: null,
  });
});

test("back on the reason step steps the flow back, it does not dismiss", async () => {
  const { onAction, onDismiss, user } = renderSheet(REASON_STEP);

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onAction).toHaveBeenCalledWith({ type: "UNDO" });
  expect(onDismiss).not.toHaveBeenCalled();
});
