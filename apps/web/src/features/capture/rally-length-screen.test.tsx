import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import type { CaptureAction } from "./capture-flow";
import { RallyLengthScreen } from "./rally-length-screen";

const ZOOM_TO = { left: 15.76, top: 6.2, width: 32.72, height: 19.73 };

function renderRallyLength() {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(<RallyLengthScreen zoomTo={ZOOM_TO} onAction={onAction} />);
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

// This is the one screen that plays the zoom-in itself (see its own doc comment) — it
// starts its own local target at null and flips to the real one in an effect, so it
// settles on the zoomed transform rather than staying at the full-court default.
test("settles on the zoomed transform, not the full-court default", async () => {
  render(<RallyLengthScreen zoomTo={ZOOM_TO} onAction={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByTestId("court-surface").style.transform).not.toBe("");
  });
});
