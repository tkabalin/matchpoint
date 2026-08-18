import {
  zForgotPasswordBody,
  zResetPasswordBody,
  zVerifyResetCodeBody,
} from "@matchpoint/api-client/zod";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
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

/** Renders ForgotPassword inside a real (in-memory) router — only needed once the
 * component reaches its "done" step, which renders a <Link>. Same pattern as
 * sign-up.test.tsx's renderSignUp(). */
async function renderForgotPassword() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/forgot-password",
    component: ForgotPassword,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([forgotPasswordRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/forgot-password"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Reset Password" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the email field", async () => {
  await renderForgotPassword();

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("updates the field as the user types", async () => {
  const user = userEvent.setup();
  await renderForgotPassword();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
});

test("blocks submit until the email is filled", async () => {
  const user = userEvent.setup();
  await renderForgotPassword();

  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeEnabled();
});

test("links back to sign in", async () => {
  const user = userEvent.setup();
  await renderForgotPassword();

  await user.click(screen.getByRole("link", { name: "Back to sign in" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

async function fillAndSubmitEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

test("sends the email to /api/auth/forgot-password", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);

  // The generated client calls fetch with a single Request object, not (url, init).
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/forgot-password");
  const body = await realRequest.json();
  // The schema comes from the API's spec, the literal below from this test. Only the
  // first can tell us the API would accept this body (see docs/testing.md).
  expect(zForgotPasswordBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({ email: "coach@example.com" });
});

test("moves to the OTP step on a 202 response", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);

  expect(
    await screen.findByText("If an account exists for coach@example.com, we've sent it a code."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
});

test("shows an inline error, the retry wait, and stays on the email step on a 429 response", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many codes requested" }), {
        status: 429,
        headers: { "Retry-After": "5" },
      }),
  );
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many codes requested Try again in 5s.",
  );
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("shows an inline error and stays on the email step on a 502 response", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Couldn't send that code, please try again" }), {
        status: 502,
      }),
  );
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't send that code, please try again",
  );
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("sends one forgot-password request however impatiently Continue is clicked", async () => {
  const respond = stubPendingFetch();
  const user = userEvent.setup();
  await renderForgotPassword();

  await fillAndSubmitEmail(user);
  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 202 }));
  expect(await screen.findByLabelText("Code")).toBeInTheDocument();
});

async function goToOtpStep(user: ReturnType<typeof userEvent.setup>) {
  stubFetch(() => new Response(null, { status: 202 }));
  await renderForgotPassword();
  await fillAndSubmitEmail(user);
  await screen.findByLabelText("Code");
  vi.unstubAllGlobals();
}

test("renders the OTP field once the OTP step is reached", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
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

test("blocks submit while the code is the wrong length, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  await user.type(screen.getByLabelText("Code"), "123");

  expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter the 6-digit code.");
});

async function fillAndSubmitOtp(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Code"), "123456");
  await user.click(screen.getByRole("button", { name: "Verify" }));
}

test("sends the email and code to /api/auth/verify-reset-code", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  stubFetch(() => new Response(null, { status: 200 }));

  await fillAndSubmitOtp(user);
  await screen.findByLabelText("New password");

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/verify-reset-code");
  const body = await realRequest.json();
  expect(zVerifyResetCodeBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({ email: "coach@example.com", otp: "123456" });
});

test("shows the server's error and stays on the OTP step on a 400 response", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Incorrect or expired code" }), { status: 400 }),
  );

  await fillAndSubmitOtp(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect or expired code");
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("shows the retry wait and disables submit on a verify-reset-code 429 response", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many attempts" }), {
        status: 429,
        headers: { "Retry-After": "7" },
      }),
  );

  await fillAndSubmitOtp(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts Try again in 7s.");
  expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
});

test("shows a generic error when the verify-reset-code request fails outright", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  await fillAndSubmitOtp(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("sends one verify-reset-code however impatiently Verify is clicked", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  const respond = stubPendingFetch();

  await fillAndSubmitOtp(user);
  const submit = screen.getByRole("button", { name: "Verify" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 200 }));
  expect(await screen.findByLabelText("New password")).toBeInTheDocument();
});

test("requesting a new code from the OTP step returns to the email step with the email preserved", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);

  await user.type(screen.getByLabelText("Code"), "123456");
  await user.click(screen.getByRole("button", { name: "Request a new one" }));

  expect(await screen.findByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
});

async function goToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  await goToOtpStep(user);
  stubFetch(() => new Response(null, { status: 200 }));
  await fillAndSubmitOtp(user);
  await screen.findByLabelText("New password");
  vi.unstubAllGlobals();
}

test("renders the new password and confirm fields once the password step is reached", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  expect(screen.getByLabelText("New password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
});

test("blocks the password submit until matching passwords are entered", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  const submit = screen.getByRole("button", { name: "Reset Password" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "granite-otter-42-quiz");
  expect(submit).toBeEnabled();
});

test("blocks submit while the new password is too short, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("New password"), "short");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Password must be at least 8 characters.",
  );
});

test("blocks submit while the passwords don't match, with a visible hint", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "zebra-canyon-1984-lark");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
});

async function fillAndSubmitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "granite-otter-42-quiz");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
}

test("sends the email and new password to /api/auth/reset-password, no code field", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(() => new Response(null, { status: 204 }));

  await fillAndSubmitPassword(user);
  await screen.findByText("Your password has been updated.");

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/reset-password");
  const body = await realRequest.json();
  // Guards the new_password/password naming trap: the request body's key must be
  // new_password, matching ResetPasswordRequestWritable, not password. The code is
  // not in it at all: the cookie the OTP step's call set is what carries that proof.
  expect(zResetPasswordBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({ email: "coach@example.com", new_password: "granite-otter-42-quiz" });
});

test("shows the server's error and stays on the password step on a 400 response", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Password rejected by policy" }), { status: 400 }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Password rejected by policy");
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
});

test("shows the server's error and stays on the password step on a 401 response", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  // The verification cookie is gone or already spent — from here the only way on is
  // starting over, since there is nothing left on this screen to re-answer.
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Reset code not verified" }), { status: 401 }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Reset code not verified");
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
});

test("shows the server's error, the retry wait, and stays on the password step on a 429 response", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": "8" },
      }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests Try again in 8s.");
  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
});

test("retries the password submit alone on failure, without re-verifying the code", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  // The OTP step's own call already spent the code by the time this screen is
  // reached — nothing on the password step can trigger verify-reset-code again, so a
  // retry here is just a second reset-password call.
  let resetCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      resetCalls += 1;
      return Promise.resolve(
        resetCalls === 1
          ? new Response(JSON.stringify({ detail: "Too many requests" }), { status: 429 })
          : new Response(null, { status: 204 }),
      );
    }),
  );

  await fillAndSubmitPassword(user);
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");

  await user.click(screen.getByRole("button", { name: "Reset Password" }));

  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
  expect(resetCalls).toBe(2);
});

test("shows a generic error when the reset-password request fails outright", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toBeInTheDocument();
});

test("sends one reset-password request however impatiently Reset Password is clicked", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  const respond = stubPendingFetch();

  await fillAndSubmitPassword(user);
  const submit = screen.getByRole("button", { name: "Reset Password" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 204 }));
  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
});

test("reaches the confirmation view once both steps succeed, and its link signs back in", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(() => new Response(null, { status: 204 }));

  await fillAndSubmitPassword(user);

  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("starting over from the password step returns to the email step with the email preserved", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.click(screen.getByRole("button", { name: "Start over" }));

  expect(await screen.findByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
});
