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
  const user = userEvent.setup();
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
  const user = userEvent.setup();
  render(<CourtDiagram zones={[zone("Long", first), zone("Wide right", second)]} />);

  await user.click(screen.getByRole("button", { name: "Long" }));
  await user.click(screen.getByRole("button", { name: "Wide right" }));

  await waitFor(() => {
    expect(first).toHaveBeenCalledTimes(1);
  });
  expect(second).not.toHaveBeenCalled();
});

test("chips the net band only when labelled", () => {
  const { rerender } = render(<CourtDiagram />);
  expect(screen.queryByText("Rally length")).not.toBeInTheDocument();

  rerender(<CourtDiagram netLabel="Rally length" />);
  expect(screen.getByText("Rally length")).toBeVisible();
});
