import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import type { EndReason, RallyBucket } from "./point";
import { RallyScreen } from "./rally-screen";

function renderRally({
  rallyBucket = null,
  won = null,
  endReason = null,
}: {
  rallyBucket?: RallyBucket | null;
  won?: boolean | null;
  endReason?: EndReason | null;
} = {}) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  const onRallyBucketChange = vi.fn<(bucket: RallyBucket | null) => void>();
  render(
    <RallyScreen
      rallyBucket={rallyBucket}
      onRallyBucketChange={onRallyBucketChange}
      won={won}
      endReason={endReason}
      trackedPlayerName="Rivera"
      opponentName="Okoye"
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
])("%s dispatches the outcome", async (name, won, endReason) => {
  const { onAction, user } = renderRally();

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_RALLY_OUTCOME", won, endReason });
});

test("neither question is required first — the outcome cards are tappable before a length is picked", async () => {
  const { onAction, user } = renderRally();

  expect(screen.getByRole("status")).toHaveTextContent("Pick the rally length and how it ended");
  expect(screen.getByRole("button", { name: "Win, forced error" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Win, forced error" }));

  expect(onAction).toHaveBeenCalledWith({
    type: "TAP_RALLY_OUTCOME",
    won: true,
    endReason: "FORCED",
  });
});

test("once an outcome is already picked, the prompt asks only for the length", () => {
  renderRally({ won: true, endReason: "FORCED" });

  expect(screen.getByRole("status")).toHaveTextContent("Pick the rally length");
});

test("once a length is already picked, the prompt asks only for the outcome", () => {
  renderRally({ rallyBucket: "B3" });

  expect(screen.getByRole("status")).toHaveTextContent("Pick how it ended");
});

test("picking a rally length reports it without ending the point", async () => {
  const { onAction, onRallyBucketChange, user } = renderRally();

  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(onRallyBucketChange).toHaveBeenCalledWith("B2");
  expect(onAction).not.toHaveBeenCalled();
});

test("the chosen rally length shows as chosen, and re-tapping keeps it", async () => {
  const { onRallyBucketChange, user } = renderRally({ rallyBucket: "B2" });

  expect(screen.getByRole("button", { name: "3-5" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "1-2" })).toHaveAttribute("aria-pressed", "false");

  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(onRallyBucketChange).toHaveBeenCalledWith("B2");
});

test("the chosen outcome shows as chosen, the same way the chosen length does", () => {
  renderRally({ won: false, endReason: "MISTAKE" });

  expect(screen.getByRole("button", { name: "Loss, unforced error" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Win, forced error" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
