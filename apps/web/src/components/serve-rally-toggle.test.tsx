import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { ServeRallyToggle } from "./serve-rally-toggle";

test("shows Serve and Rally, and marks the current value as pressed", () => {
  render(<ServeRallyToggle value="serve" onValueChange={vi.fn()} />);

  expect(screen.getByRole("button", { name: "Serve" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Rally" })).toHaveAttribute("aria-pressed", "false");
});

test("clicking the other option reports it, without changing which one is marked active here", async () => {
  const onValueChange = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<ServeRallyToggle value="serve" onValueChange={onValueChange} />);

  await user.click(screen.getByRole("button", { name: "Rally" }));

  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("rally");
});

// The active option needs a louder, primary-colored state than the app's usual
// muted toggle — not just an accessibility attribute — since this switch sits
// right below the surface record card with nothing else marking it interactive.
test("the active option is styled with the primary color, not the muted default", () => {
  render(<ServeRallyToggle value="rally" onValueChange={vi.fn()} />);

  expect(screen.getByRole("button", { name: "Serve" })).not.toHaveClass("bg-primary");
  expect(screen.getByRole("button", { name: "Rally" })).toHaveClass("bg-primary");
});
