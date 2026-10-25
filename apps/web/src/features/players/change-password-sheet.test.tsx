import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { ChangePasswordSheet } from "./change-password-sheet";

/** A stateful host, the same shape `player-settings-account.tsx` actually
 * renders this sheet inside of — lets a test open, close, and reopen it
 * through its own `onOpenChange` the way a real parent does, rather than
 * puppeting `open` by hand across separate renders. */
function Host({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <ChangePasswordSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function stubFetch(routes: Record<string, (input: Request) => Response | Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: Request) => {
      const { pathname } = new URL(input.url);
      const key = `${input.method} ${pathname}`;
      const handler = routes[key];
      if (!handler) throw new Error(`Unstubbed fetch: ${key}`);
      return Promise.resolve(handler(input));
    }),
  );
}

function renderSheet(open = true) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangePasswordSheet open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

async function fillPasswordFields(
  user: ReturnType<typeof userEvent.setup>,
  current = "onetimepass",
  next = "correct-horse-battery-staple",
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), next);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the change-password fields when open", () => {
  renderSheet();

  expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
});

test("renders nothing when closed", () => {
  renderSheet(false);

  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
});

test("blocks submit until the new password and its confirmation match", async () => {
  const user = userEvent.setup({ delay: null });
  renderSheet();

  const submit = screen.getByRole("button", { name: "Change password" });
  expect(submit).toBeDisabled();

  await fillPasswordFields(user);
  expect(submit).toBeEnabled();
});

test("shows a mismatch error and blocks submit when the confirmation differs", async () => {
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await user.type(screen.getByLabelText("Current password"), "onetimepass");
  await user.type(screen.getByLabelText("New password"), "correct-horse-battery-staple");
  await user.type(screen.getByLabelText("Confirm new password"), "something-else");

  expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change password" })).toBeDisabled();
});

test("changes the password, closes the sheet, and posts the right body", async () => {
  const posted: unknown[] = [];
  stubFetch({
    "POST /api/auth/player/change-password": async (input) => {
      posted.push(JSON.parse(await input.text()));
      return new Response(null, { status: 204 });
    },
  });
  const user = userEvent.setup({ delay: null });
  const { onOpenChange } = renderSheet();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(posted).toEqual([
    { password: "onetimepass", new_password: "correct-horse-battery-staple" },
  ]);
});

test("shows the server's message when the current password is wrong", async () => {
  stubFetch({
    "POST /api/auth/player/change-password": () =>
      new Response(JSON.stringify({ detail: "Incorrect password" }), { status: 403 }),
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Incorrect password")).toBeInTheDocument();
});

test("shows the server's message when the new password fails its policy", async () => {
  stubFetch({
    "POST /api/auth/player/change-password": () =>
      new Response(JSON.stringify({ detail: "Password rejected by policy" }), { status: 400 }),
  });
  const user = userEvent.setup({ delay: null });
  renderSheet();

  await fillPasswordFields(user);
  await user.click(screen.getByRole("button", { name: "Change password" }));

  expect(await screen.findByText("Password rejected by policy")).toBeInTheDocument();
});

test("clears its fields once closed and reopened", async () => {
  const user = userEvent.setup({ delay: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Host />
    </QueryClientProvider>,
  );

  await user.type(screen.getByLabelText("Current password"), "something");
  // Base UI's Sheet close button has no accessible name beyond "Close" by convention.
  await user.click(screen.getByRole("button", { name: /close/i }));
  await user.click(screen.getByRole("button", { name: "Reopen" }));

  expect(screen.getByLabelText("Current password")).toHaveValue("");
});

test("Sign Out is not part of this sheet", () => {
  renderSheet();

  expect(within(screen.getByRole("dialog")).queryByText("Sign Out")).not.toBeInTheDocument();
});
