import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { RallyLengthScreen } from "./rally-length-screen";

function renderRallyLength() {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<RallyLengthScreen onAction={onAction} />);
  return { onAction, user: userEvent.setup({ delay: null }) };
}

test.each([
  ["1-2", "B1"],
  ["3-5", "B2"],
  ["6-10", "B3"],
  ["11+", "B4"],
])("%s records its bucket in one tap", async (name, bucket) => {
  const { onAction, user } = renderRallyLength();

  await user.click(screen.getByRole("button", { name }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_RALLY_LENGTH", bucket });
});
