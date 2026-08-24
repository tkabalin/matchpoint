import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import type { RallyBucket } from "./point";
import { RallyScreen } from "./rally-screen";

function renderRally(rallyBucket: RallyBucket | null = null) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  const onRallyBucketChange = vi.fn<(bucket: RallyBucket | null) => void>();
  render(
    <RallyScreen
      rallyBucket={rallyBucket}
      onRallyBucketChange={onRallyBucketChange}
      onAction={onAction}
    />,
  );
  return { onAction, onRallyBucketChange, user: userEvent.setup() };
}

test.each([
  ["Win, forced error", true, "FORCED"],
  ["Win, unforced error", true, "MISTAKE"],
  ["Loss, forced error", false, "FORCED"],
  ["Loss, unforced error", false, "MISTAKE"],
])("%s ends the point", async (name, won, endReason) => {
  const { onAction, user } = renderRally("B2");

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_RALLY_OUTCOME", won, endReason });
});

test("the point cannot be ended before its length is answered", async () => {
  const { onAction, user } = renderRally();

  expect(screen.getByRole("status")).toHaveTextContent("Pick the rally length, then how it ended");
  await user.click(screen.getByRole("button", { name: "Win, forced error" }));

  expect(onAction).not.toHaveBeenCalled();
});

test("once a length is chosen the endings become available", () => {
  renderRally("B3");

  expect(screen.getByRole("status")).toHaveTextContent("Pick how it ended");
  expect(screen.getByRole("button", { name: "Win, forced error" })).toBeEnabled();
});

test("picking a rally length reports it without ending the point", async () => {
  const { onAction, onRallyBucketChange, user } = renderRally();

  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(onRallyBucketChange).toHaveBeenCalledWith("B2");
  expect(onAction).not.toHaveBeenCalled();
});

test("the chosen rally length shows as chosen, and re-tapping keeps it", async () => {
  const { onRallyBucketChange, user } = renderRally("B2");

  expect(screen.getByRole("button", { name: "3-5" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "1-2" })).toHaveAttribute("aria-pressed", "false");

  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(onRallyBucketChange).toHaveBeenCalledWith("B2");
});

test("an unusual ending hands off to the flow's own unusual path", async () => {
  const { onAction, user } = renderRally();

  await user.click(screen.getByRole("button", { name: "Unusual point end" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_UNUSUAL" });
});

test("a let replays the point from the first serve", async () => {
  const { onAction, user } = renderRally();

  await user.click(screen.getByRole("button", { name: "Let" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_LET" });
});
