import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { UpdatePrompt } from "./update-prompt";

test("reloads only when the user asks for it", async () => {
  const onReload = vi.fn();
  render(<UpdatePrompt onReload={onReload} onDismiss={vi.fn()} />);

  expect(onReload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));

  expect(onReload).toHaveBeenCalledOnce();
});

test("asks to be dismissed without reloading", async () => {
  const onReload = vi.fn();
  const onDismiss = vi.fn();
  render(<UpdatePrompt onReload={onReload} onDismiss={onDismiss} />);

  await userEvent.click(screen.getByRole("button", { name: "Later" }));

  expect(onDismiss).toHaveBeenCalledOnce();
  expect(onReload).not.toHaveBeenCalled();
});

// Focus is what makes a screen reader read the banner out: it is inserted complete, so a
// live region would have nothing to announce.
test("takes focus as a labelled dialog, and hands it back when it goes", () => {
  const elsewhere = document.body.appendChild(document.createElement("button"));
  elsewhere.focus();

  const { unmount } = render(<UpdatePrompt onReload={vi.fn()} onDismiss={vi.fn()} />);

  expect(
    screen.getByRole("alertdialog", { name: "A new version of MatchPoint is available." }),
  ).toHaveFocus();

  unmount();
  expect(elsewhere).toHaveFocus();
  elsewhere.remove();
});
