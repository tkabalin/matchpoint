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

/** Stubs the reset step's two calls: 200 for the verification, 204 for the reset. One
 * status cannot serve both, so the stub answers on the URL it was called with. */
function stubResetFlow() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((request: Request) => {
      const status = request.url.includes("verify-reset-code") ? 200 : 204;
      return Promise.resolve(new Response(null, { status }));
    }),
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

test("moves to the reset step on a 202 response", async () => {
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

async function goToResetStep(user: ReturnType<typeof userEvent.setup>) {
  stubFetch(() => new Response(null, { status: 202 }));
  await renderForgotPassword();
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
  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "granite-otter-42-quiz");
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

  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "zebra-canyon-1984-lark");

  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
});

async function fillAndSubmitReset(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Code"), "123456");
  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.type(screen.getByLabelText("Confirm password"), "granite-otter-42-quiz");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
}

test("answers the code, then sends the new password to /api/auth/reset-password", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  stubResetFlow();

  await fillAndSubmitReset(user);
  await screen.findByText("Your password has been updated.");

  // The generated client calls fetch with a single Request object, not (url, init).
  const requests = vi.mocked(fetch).mock.calls.map(([call]) => call as Request);
  expect(requests).toHaveLength(2);
  const [verifyRequest, resetRequest] = requests as [Request, Request];
  expect(verifyRequest.url).toContain("/api/auth/verify-reset-code");
  const verifyBody = await verifyRequest.json();
  // The schema comes from the API's spec, the literal below from this test. Only the
  // first can tell us the API would accept this body (see docs/testing.md).
  expect(zVerifyResetCodeBody.safeParse(verifyBody).error).toBeUndefined();
  expect(verifyBody).toEqual({ email: "coach@example.com", otp: "123456" });
  // Guards the new_password/password naming trap: the request body's key must be
  // new_password, matching ResetPasswordRequestWritable, not password. The code is not
  // in it at all: the cookie the call above set is what carries that proof now.
  expect(resetRequest.url).toContain("/api/auth/reset-password");
  const resetBody = await resetRequest.json();
  expect(zResetPasswordBody.safeParse(resetBody).error).toBeUndefined();
  expect(resetBody).toEqual({
    email: "coach@example.com",
    new_password: "granite-otter-42-quiz",
  });
});

test("shows the server's error and stays on the reset step on a 400 response", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Incorrect or expired code" }), { status: 400 }),
  );

  await fillAndSubmitReset(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect or expired code");
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  // A refused code never reaches the password call: there is no cookie for it to use.
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("shows the server's error and stays on the reset step on a 401 response", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  // The code verifies, and the reset then meets a 401: the proof it minted is missing or
  // already spent, which from here means starting the flow over.
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((request: Request) =>
        Promise.resolve(
          request.url.includes("verify-reset-code")
            ? new Response(null, { status: 200 })
            : new Response(JSON.stringify({ detail: "Reset code not verified" }), { status: 401 }),
        ),
      ),
  );

  await fillAndSubmitReset(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Reset code not verified");
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("shows the server's error, the retry wait, and stays on the reset step on a 429 response", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many attempts" }), {
        status: 429,
        headers: { "Retry-After": "8" },
      }),
  );

  await fillAndSubmitReset(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts Try again in 8s.");
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reset Password" })).toBeDisabled();
});

test("retries the password call alone, so a failure does not spend the code twice", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  // verify-reset-code spends the code as it answers it, so the retry has to go straight
  // to the password call. Answering the code a second time would meet the 400 a spent one
  // gets, losing a reset the coach typed correctly.
  let resetCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((request: Request) => {
      if (request.url.includes("verify-reset-code")) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      resetCalls += 1;
      // No Retry-After, so nothing keeps the button disabled and the retry is a click away.
      return Promise.resolve(
        resetCalls === 1
          ? new Response(JSON.stringify({ detail: "Too many requests" }), { status: 429 })
          : new Response(null, { status: 204 }),
      );
    }),
  );

  await fillAndSubmitReset(user);
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  // And the code is settled, so the retry cannot be a different code than the one the
  // proof was minted for.
  expect(screen.getByLabelText("Code")).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Reset Password" }));

  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
  const verifications = vi
    .mocked(fetch)
    .mock.calls.filter(([request]) => (request as Request).url.includes("verify-reset-code"));
  expect(verifications).toHaveLength(1);
  expect(resetCalls).toBe(2);
});

test("shows a generic error when the reset-password request fails outright", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  await fillAndSubmitReset(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("sends one reset request however impatiently Reset Password is clicked", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  // Only the verification is left hanging; the reset behind it answers at once, so what
  // the click count proves is that the flow itself ran only once.
  let respond!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 }))),
  );

  await fillAndSubmitReset(user);
  const submit = screen.getByRole("button", { name: "Reset Password" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 200 }));
  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
});

test("reaches the confirmation view once both calls succeed, and its link signs back in", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);
  stubResetFlow();

  await fillAndSubmitReset(user);

  expect(await screen.findByText("Your password has been updated.")).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("starting over returns to the email step with the email preserved", async () => {
  const user = userEvent.setup();
  await goToResetStep(user);

  await user.type(screen.getByLabelText("Code"), "123456");
  await user.type(screen.getByLabelText("New password"), "granite-otter-42-quiz");
  await user.click(screen.getByRole("button", { name: "Request a new one" }));

  expect(await screen.findByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
});
