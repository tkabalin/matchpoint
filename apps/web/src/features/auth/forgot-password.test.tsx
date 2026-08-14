import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { ForgotPassword } from "./forgot-password";

/** Stubs the transport, not the component — same reasoning as sign-up.test.tsx: a
 * factory, not a shared Response, since a body can only be read once. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Stubs a fetch that stays unresolved until the returned function answers it, so the
 * in-flight window is observable from a test — same as sign-up.test.tsx. */
function stubPendingFetch() {
  let respond!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
  return respond;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the email field", () => {
  render(<ForgotPassword />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("updates the field as the user types", async () => {
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await user.type(screen.getByLabelText("Email"), "coach@example.com");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
});

test("blocks submit until the email is filled", async () => {
  const user = userEvent.setup();
  render(<ForgotPassword />);

  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeEnabled();
});

async function fillAndSubmitEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

test("sends the email to /api/auth/forgot-password", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);

  // The generated client calls fetch with a single Request object, not (url, init).
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/forgot-password");
  expect(await realRequest.json()).toEqual({ email: "coach@example.com" });
});

test("moves to the reset step on a 202 response", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);

  expect(
    await screen.findByText("If an account exists for coach@example.com, we've sent it a code."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
});

test("shows an inline error and stays on the email step on a 429 response", async () => {
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Too many codes requested" }), { status: 429 }),
  );
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Too many codes requested");
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("shows an inline error and stays on the email step on a 502 response", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Couldn't send that code, please try again" }), {
        status: 502,
      }),
  );
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't send that code, please try again",
  );
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("sends one forgot-password request however impatiently Continue is clicked", async () => {
  const respond = stubPendingFetch();
  const user = userEvent.setup();
  render(<ForgotPassword />);

  await fillAndSubmitEmail(user);
  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 202 }));
  expect(await screen.findByLabelText("Code")).toBeInTheDocument();
});

async function goToResetStep(user: ReturnType<typeof userEvent.setup>) {
  stubFetch(() => new Response(null, { status: 202 }));
  render(<ForgotPassword />);
  await fillAndSubmitEmail(user);
  await screen.findByLabelText("Code");
  vi.unstubAllGlobals();
}

test("renders the reset step's fields once it's reached", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
});

test("blocks the reset submit until the code and matching passwords are entered", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  const submit = screen.getByRole("button", { name: "Reset Password" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Code"), "123456");
  await user.type(screen.getByLabelText("New password"), "newpassword1");
  await user.type(screen.getByLabelText("Confirm password"), "newpassword1");
  expect(submit).toBeEnabled();
});

test("blocks submit while the code is the wrong length, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  await user.type(screen.getByLabelText("Code"), "123");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter the 6-digit code.");
});

test("blocks submit while the new password is too short, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  await user.type(screen.getByLabelText("New password"), "short");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Password must be at least 8 characters.",
  );
});

test("blocks submit while the passwords don't match, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  await user.type(screen.getByLabelText("New password"), "newpassword1");
  await user.type(screen.getByLabelText("Confirm password"), "newpassword2");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
});
