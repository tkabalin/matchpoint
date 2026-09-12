import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { CourtDiagram } from "./court-diagram";
import type { CourtTapZone } from "./court-diagram";

// Real timers throughout: the flash is a 420ms setTimeout, and faking it stalls
// user-event's own scheduling (the reason home.test.tsx fakes Date alone).

function zone(name: string, onTap: () => void): CourtTapZone {
  return { name, box: { left: "0", top: "0", width: "50%", height: "50%" }, tone: "in", onTap };
}

test("renders one tap target per zone, named for the coach", () => {
  render(
    <CourtDiagram
      zones={[
        { ...zone("Deuce service box", vi.fn()), label: "Deuce" },
        zone("Wide left", vi.fn()),
      ]}
    />,
  );

  expect(screen.getByRole("button", { name: "Deuce service box" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Wide left" })).toBeVisible();
});

test("a tap flashes before the flow advances", async () => {
  const onTap = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<CourtDiagram zones={[zone("Net", onTap)]} />);

  await user.click(screen.getByRole("button", { name: "Net" }));
  expect(onTap).not.toHaveBeenCalled();

  await waitFor(() => {
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

test("a second tap during the flash does not advance twice", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<CourtDiagram zones={[zone("Long", first), zone("Wide right", second)]} />);

  await user.click(screen.getByRole("button", { name: "Long" }));
  await user.click(screen.getByRole("button", { name: "Wide right" }));

  await waitFor(() => {
    expect(first).toHaveBeenCalledTimes(1);
  });
  expect(second).not.toHaveBeenCalled();
});

test("reports pending while a tap's flash is in flight", async () => {
  const onPendingChange = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<CourtDiagram zones={[zone("Net", vi.fn())]} onPendingChange={onPendingChange} />);

  await user.click(screen.getByRole("button", { name: "Net" }));
  expect(onPendingChange).toHaveBeenLastCalledWith(true);

  await waitFor(() => {
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });
});

test("chips the net band only when labelled", () => {
  const { rerender } = render(<CourtDiagram />);
  expect(screen.queryByText("Rally length")).not.toBeInTheDocument();

  rerender(<CourtDiagram netLabel="Rally length" />);
  expect(screen.getByText("Rally length")).toBeVisible();
});

test("carries no transform when zoomTo is absent, and clears one when it goes away", () => {
  const { rerender } = render(<CourtDiagram zoomTo={{ left: 0, top: 0, width: 50, height: 50 }} />);
  expect(screen.getByTestId("court-surface")).toHaveStyle({
    transform: "translate(0%, 0%) scale(2)",
  });

  rerender(<CourtDiagram />);
  expect(screen.getByTestId("court-surface").style.transform).toBe("");
});

test("zooms into a region off-centre, uniformly scaled and centred on it", () => {
  // A region in the bottom-right quarter of the court: covering it needs 4x (the
  // limiting axis, both are 25% wide here), and both left and top translate so the
  // region's own centre (87.5%, 87.5%) lands back on the viewport's centre.
  render(<CourtDiagram zoomTo={{ left: 75, top: 75, width: 25, height: 25 }} />);

  expect(screen.getByTestId("court-surface")).toHaveStyle({
    transform: "translate(-300%, -300%) scale(4)",
  });
});
