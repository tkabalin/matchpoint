import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { SignUp } from "./sign-up";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx:
 * a factory, not a shared Response, since a body can only be read once. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

async function fillAndSubmitEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the email field", () => {
  render(<SignUp />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("updates the field as the user types", async () => {
  const user = userEvent.setup();
  render(<SignUp />);

  await user.type(screen.getByLabelText("Email"), "coach@example.com");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
});

test("blocks submit until the email is filled", async () => {
  const user = userEvent.setup();
  render(<SignUp />);

  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeEnabled();
});

test("sends the email to /api/auth/request-otp with cookies included", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<SignUp />);

  await fillAndSubmitEmail(user);

  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe("/api/auth/request-otp");
  expect(init?.credentials).toBe("include");
  expect(JSON.parse(String(init?.body))).toEqual({ email: "coach@example.com" });
});

test("moves to the OTP step on a 202 response", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<SignUp />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByText("We sent a code to coach@example.com.")).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
});

test("shows an inline error and stays on the email step on a 409 response", async () => {
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Email already registered" }), { status: 409 }),
  );
  const user = userEvent.setup();
  render(<SignUp />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered");
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup();
  render(<SignUp />);

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

async function goToOtpStep(user: ReturnType<typeof userEvent.setup>) {
  stubFetch(() => new Response(null, { status: 202 }));
  render(<SignUp />);
  await fillAndSubmitEmail(user);
  await screen.findByLabelText("Code");
  vi.unstubAllGlobals();
}

test("renders the OTP field once the OTP step is reached", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("updates the OTP field as the user types", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  await user.type(screen.getByLabelText("Code"), "123456");

  expect(screen.getByLabelText("Code")).toHaveValue("123456");
});

test("blocks the OTP submit until a code is entered", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  const submit = screen.getByRole("button", { name: "Verify" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Code"), "123456");
  expect(submit).toBeEnabled();
});

async function goToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await goToOtpStep(user);
  await user.type(screen.getByLabelText("Code"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify" }));
  await screen.findByLabelText("Password");
}

test("renders the password and confirm fields once the password step is reached", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
});

test("blocks submit while the passwords differ, with a visible error", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  const submit = screen.getByRole("button", { name: "Sign Up" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Password"), "hunter2");
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Confirm password"), "hunter3");
  expect(submit).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
});

test("allows submit once the passwords match", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.type(screen.getByLabelText("Confirm password"), "hunter2");

  expect(screen.getByRole("button", { name: "Sign Up" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
