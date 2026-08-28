import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
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
test("takes focus as a labelled dialog", () => {
  render(<UpdatePrompt onReload={vi.fn()} onDismiss={vi.fn()} />);

  expect(
    screen.getByRole("alertdialog", { name: "A new version of MatchPoint is available." }),
  ).toHaveFocus();
});

// The other half of that, through the path production actually takes: main.tsx mounts the
// banner in its own root under StrictMode and unmounts it on dismiss. StrictMode runs the
// focus effect mount-cleanup-mount, so a `previouslyFocused` captured anywhere but inside
// the effect comes back as the banner itself and strands focus on a removed node. The
// banner also has to arrive *after* something is focused — mounted together with the page,
// `document.activeElement` is the body, the `instanceof HTMLElement` guard skips the
// restore, and the test would assert nothing.
test("hands focus back to the screen behind it when the user dismisses it", async () => {
  function Host() {
    const [updateWaiting, setUpdateWaiting] = useState(false);
    return (
      <>
        <button onClick={() => setUpdateWaiting(true)}>Ace</button>
        {updateWaiting && (
          <UpdatePrompt onReload={vi.fn()} onDismiss={() => setUpdateWaiting(false)} />
        )}
      </>
    );
  }

  const user = userEvent.setup({ delay: null });
  render(
    <StrictMode>
      <Host />
    </StrictMode>,
  );

  const capture = screen.getByRole("button", { name: "Ace" });
  await user.click(capture);
  expect(screen.getByRole("alertdialog")).toHaveFocus();

  await user.click(screen.getByRole("button", { name: "Later" }));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(capture).toHaveFocus();
});
