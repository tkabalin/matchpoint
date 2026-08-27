import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction, CaptureStep } from "./capture-flow";
import { ReturnScreen } from "./return-screen";

// Real timers: the court's flash is a 420ms setTimeout, same as court-diagram.test.tsx.

const SERVE_1: Extract<CaptureStep, { name: "SERVE" }> = { name: "SERVE", number: 1 };
const SERVE_2: Extract<CaptureStep, { name: "SERVE" }> = { name: "SERVE", number: 2 };

function renderReturn(options: { step?: typeof SERVE_1 } = {}) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<ReturnScreen step={options.step ?? SERVE_1} onAction={onAction} />);
  return { onAction, user: userEvent.setup() };
}

test("asks where the return landed", () => {
  renderReturn();

  expect(screen.getByRole("heading", { name: "Return" })).toBeVisible();
  expect(screen.getByText("Only safe area")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Tap where the return landed");
});

test("a return into the safe area goes straight to the rally", async () => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: "Safe area" }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({ type: "TAP_RETURN", outcome: "IN" });
  });
});

test.each([
  ["Long", "LONG"],
  ["Wide (left)", "WIDE"],
  ["Wide (right)", "WIDE"],
  ["Net", "NET"],
])("a return %s asks whether it was forced before recording it", async (zone, outcome) => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: zone }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Was the return forced?" })).toBeVisible();
  });
  expect(onAction).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: /Forced/ }));

  expect(onAction).toHaveBeenCalledWith({
    type: "TAP_RETURN",
    outcome,
    endReason: "FORCED",
  });
});

test("a returnable ball missed is recorded as a mistake", async () => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: "Net" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Was the return forced?" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: /Unforced/ }));

  expect(onAction).toHaveBeenCalledWith({
    type: "TAP_RETURN",
    outcome: "NET",
    endReason: "MISTAKE",
  });
});

test("an ace against us carries no placement", async () => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: "Ace" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_ACE" });
});

test("the opponent's fault carries no placement either", async () => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: "Fault" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_FAULT" });
});

test("ace, fault and let are disabled while a court tap's flash is pending", async () => {
  const { user } = renderReturn();

  // "Safe area" dispatches straight through rather than opening the forced/mistake
  // sheet, so it doesn't hide the rest of the screen from the accessibility tree.
  await user.click(screen.getByRole("button", { name: "Safe area" }));
  expect(screen.getByRole("button", { name: "Ace" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fault" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Let" })).toBeDisabled();

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Ace" })).toBeEnabled();
  });
  expect(screen.getByRole("button", { name: "Fault" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Let" })).toBeEnabled();
});

test("the second attempt says a second serve is coming, without a reason", () => {
  renderReturn({ step: SERVE_2 });

  expect(screen.getByRole("status")).toHaveTextContent("Fault. Second serve.");
});

test("a let reports itself and leaves the attempt where it was", async () => {
  const { onAction, user } = renderReturn();

  await user.click(screen.getByRole("button", { name: "Let" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_LET" });
  expect(screen.getByRole("status")).toHaveTextContent("Let — replay the point.");
});
