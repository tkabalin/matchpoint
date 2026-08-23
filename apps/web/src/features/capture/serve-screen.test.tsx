import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { startPoint } from "./capture-flow";
import type { CaptureAction, CaptureStep, PointDraft } from "./capture-flow";
import { ServeScreen } from "./serve-screen";
import type { CourtSide } from "./point";

// Real timers: the court's flash is a 420ms setTimeout, same as court-diagram.test.tsx.

const SERVE_1: Extract<CaptureStep, { name: "SERVE" }> = { name: "SERVE", number: 1 };
const SERVE_2: Extract<CaptureStep, { name: "SERVE" }> = { name: "SERVE", number: 2 };

function draftFor(courtSide: CourtSide = "DEUCE"): PointDraft {
  return startPoint("match-1", 0, "TRACKED", courtSide).draft;
}

function renderServe(options: { step?: typeof SERVE_1; draft?: PointDraft } = {}) {
  const onAction = vi.fn<(action: CaptureAction) => void>();
  render(
    <ServeScreen
      step={options.step ?? SERVE_1}
      draft={options.draft ?? draftFor()}
      onAction={onAction}
    />,
  );
  return { onAction, user: userEvent.setup() };
}

test("titles the attempt and names the court the point is played from", () => {
  renderServe({ draft: draftFor("AD") });

  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  expect(screen.getByText("Ad court")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Tap where the serve landed");
});

test("a tap in the live service box records a serve in, with no placement", async () => {
  const { onAction, user } = renderServe();

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_IN" });
  });
});

test("the live box follows the court side the point is played from", async () => {
  const { onAction, user } = renderServe({ draft: draftFor("AD") });

  await user.click(screen.getByRole("button", { name: "Ad service box" }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_IN" });
  });
});

test.each([
  ["Long", "LONG"],
  ["Long (ad side)", "LONG"],
  ["Wide (left)", "WIDE"],
  ["Wide (right)", "WIDE"],
  ["Net", "NET"],
  // The box this point isn't played into — the serve crossed the centre line.
  ["Ad service box", "WIDE"],
])("a tap on %s faults with location %s", async (zone, location) => {
  const { onAction, user } = renderServe();

  await user.click(screen.getByRole("button", { name: zone }));

  await waitFor(() => {
    expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_FAULT", location });
  });
});

test("the ace button records an ace with no placement", async () => {
  const { onAction, user } = renderServe();

  await user.click(screen.getByRole("button", { name: "Ace" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_SERVE_ACE" });
});

test("the second attempt says why the first one faulted", () => {
  const draft = draftFor();
  renderServe({
    step: SERVE_2,
    draft: { ...draft, serves: [{ number: 1, outcome: "FAULT", location: "NET" }] },
  });

  expect(screen.getByRole("heading", { name: "2nd Serve" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Fault — into net. Second serve.");
});

test("a let reports itself and leaves the attempt where it was", async () => {
  const { onAction, user } = renderServe();

  await user.click(screen.getByRole("button", { name: "Let" }));

  expect(onAction).toHaveBeenCalledWith({ type: "TAP_LET" });
  expect(screen.getByRole("status")).toHaveTextContent("Let — replay the point.");
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});
