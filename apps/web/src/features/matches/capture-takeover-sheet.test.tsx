import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { CaptureTakeoverSheet } from "./capture-takeover-sheet";

test("renders the takeover prompt, and Take over invokes the handler", async () => {
  const onTakeOver = vi.fn();
  const user = userEvent.setup();
  render(
    <CaptureTakeoverSheet
      open
      takingOver={false}
      error={null}
      onTakeOver={onTakeOver}
      onDecline={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Being captured on another device" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Take over on this one/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Take over" }));

  expect(onTakeOver).toHaveBeenCalledOnce();
});

test("Cancel invokes decline", async () => {
  const onDecline = vi.fn();
  const user = userEvent.setup();
  render(
    <CaptureTakeoverSheet
      open
      takingOver={false}
      error={null}
      onTakeOver={vi.fn()}
      onDecline={onDecline}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onDecline).toHaveBeenCalledOnce();
});

test("shows the busy label and disables both buttons while taking over", () => {
  render(
    <CaptureTakeoverSheet open takingOver error={null} onTakeOver={vi.fn()} onDecline={vi.fn()} />,
  );

  expect(screen.getByRole("button", { name: "Taking over…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
});

test("shows a repeat-conflict error", () => {
  render(
    <CaptureTakeoverSheet
      open
      takingOver={false}
      error="Still being captured on that device. Try again."
      onTakeOver={vi.fn()}
      onDecline={vi.fn()}
    />,
  );

  expect(screen.getByText("Still being captured on that device. Try again.")).toBeInTheDocument();
});

test("renders nothing visible when closed", () => {
  render(
    <CaptureTakeoverSheet
      open={false}
      takingOver={false}
      error={null}
      onTakeOver={vi.fn()}
      onDecline={vi.fn()}
    />,
  );

  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});
