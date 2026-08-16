import { zCreateCoachBody, zRequestOtpBody, zVerifyOtpBody } from "@matchpoint/api-client/zod";
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

import { SignUp } from "./sign-up";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx:
 * a factory, not a shared Response, since a body can only be read once. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Stubs a fetch that stays unresolved until the returned function answers it, so the
 * in-flight window is observable from a test — the double-submit guard exists only
 * during it, and a stubFetch response is already settled by the time a click returns. */
function stubPendingFetch() {
  let respond!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
  return respond;
}

/** Renders SignUp inside a real (in-memory) router rather than mocking useNavigate,
 * so a successful sign-up is verified by what actually ends up on screen — same
 * pattern as sign-in.test.tsx. Needed for every test now, not just the navigation
 * ones: SignUp calls useNavigate() unconditionally, which throws without a router
 * context regardless of whether a given test ever reaches the password step. */
async function renderSignUp() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const signUpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-up",
    component: SignUp,
  });
  const signInRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Sign In</h1>,
  });
  const routeTree = rootRoute.addChildren([signUpRoute, signInRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/sign-up"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Sign Up" });
}

async function fillAndSubmitEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the email field", async () => {
  await renderSignUp();

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("updates the field as the user types", async () => {
  const user = userEvent.setup();
  await renderSignUp();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
});

test("blocks submit until the email is filled", async () => {
  const user = userEvent.setup();
  await renderSignUp();

  const submit = screen.getByRole("button", { name: "Continue" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeEnabled();
});

test("links back to sign in", async () => {
  const user = userEvent.setup();
  await renderSignUp();

  await user.click(screen.getByRole("link", { name: "Back to sign in" }));

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("sends the email to /api/auth/request-otp", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  await renderSignUp();

  await fillAndSubmitEmail(user);

  // The generated client calls fetch with a single Request object, not (url, init) —
  // same pattern player-list.test.tsx uses for the same reason.
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/request-otp");
  const body = await realRequest.json();
  // The schema comes from the API's spec, the literal below from this test. Only the
  // first can tell us the API would accept this body (see docs/testing.md).
  expect(zRequestOtpBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({ email: "coach@example.com" });
});

test("moves to the OTP step on a 202 response", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  await renderSignUp();

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
  await renderSignUp();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered");
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("falls back to an explicit message when the response has no detail to show", async () => {
  stubFetch(() => new Response(JSON.stringify({}), { status: 500 }));
  const user = userEvent.setup();
  await renderSignUp();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't send you a verification code. Please try again.",
  );
});

test("shows the retry wait and disables submit on a 429 response", async () => {
  // The countdown's tick-by-tick behavior is covered by use-countdown.test.ts's own
  // unit tests — this only needs to prove a 429 wires the header into the UI at all.
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many codes requested" }), {
        status: 429,
        headers: { "Retry-After": "5" },
      }),
  );
  const user = userEvent.setup();
  await renderSignUp();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many codes requested Try again in 5s.",
  );
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup();
  await renderSignUp();

  await fillAndSubmitEmail(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("sends one request-otp however impatiently Continue is clicked", async () => {
  const respond = stubPendingFetch();
  const user = userEvent.setup();
  await renderSignUp();

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
  await renderSignUp();
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

test("sends the email and code to /api/auth/verify-otp", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  stubFetch(() => new Response(null, { status: 200 }));

  await fillAndSubmitOtp(user);
  await screen.findByLabelText("Password");

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/verify-otp");
  const body = await realRequest.json();
  expect(zVerifyOtpBody.safeParse(body).error).toBeUndefined();
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

test("shows the retry wait and disables submit on a verify-otp 429 response", async () => {
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

test("shows a generic error when the verify-otp request fails outright", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  await fillAndSubmitOtp(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Code")).toBeInTheDocument();
});

test("sends one verify-otp however impatiently Verify is clicked", async () => {
  const user = userEvent.setup();
  await goToOtpStep(user);
  const respond = stubPendingFetch();

  await fillAndSubmitOtp(user);
  const submit = screen.getByRole("button", { name: "Verify" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  expect(fetch).toHaveBeenCalledTimes(1);

  respond(new Response(null, { status: 200 }));
  expect(await screen.findByLabelText("Password")).toBeInTheDocument();
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
  await screen.findByLabelText("Password");
  vi.unstubAllGlobals();
}

test("renders the display name, password and confirm fields once the password step is reached", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  expect(screen.getByLabelText("Display name")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
});

test("blocks submit until a display name is entered", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("Password"), "hunter2000");
  await user.type(screen.getByLabelText("Confirm password"), "hunter2000");
  const submit = screen.getByRole("button", { name: "Sign Up" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  expect(submit).toBeEnabled();
});

test("blocks submit while the password is too short, with a visible error", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  await user.type(screen.getByLabelText("Password"), "short1");
  await user.type(screen.getByLabelText("Confirm password"), "short1");

  expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Password must be at least 8 characters.",
  );
});

test("blocks submit while the password is too long, with a visible error", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  const tooLong = "a".repeat(129);

  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  await user.type(screen.getByLabelText("Password"), tooLong);
  await user.type(screen.getByLabelText("Confirm password"), tooLong);

  expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Password must be at most 128 characters.",
  );
});

test("blocks submit while the passwords differ, with a visible error", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  const submit = screen.getByRole("button", { name: "Sign Up" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  await user.type(screen.getByLabelText("Password"), "hunter2000");
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Confirm password"), "hunter2001");
  expect(submit).toBeDisabled();
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
});

test("allows submit once the display name is set and the passwords match", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  await user.type(screen.getByLabelText("Password"), "hunter2000");
  await user.type(screen.getByLabelText("Confirm password"), "hunter2000");

  expect(screen.getByRole("button", { name: "Sign Up" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

async function fillAndSubmitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Display name"), "Amahle Nkosi");
  await user.type(screen.getByLabelText("Password"), "hunter2000");
  await user.type(screen.getByLabelText("Confirm password"), "hunter2000");
  await user.click(screen.getByRole("button", { name: "Sign Up" }));
}

test("sends the email, password and display name to POST /coaches, no token field", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(() =>
    Response.json(
      { id: "1", email: "coach@example.com", display_name: "Amahle Nkosi" },
      { status: 201 },
    ),
  );

  await fillAndSubmitPassword(user);
  await screen.findByRole("heading", { name: "Sign In" });

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/coaches");
  const body = await realRequest.json();
  expect(zCreateCoachBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({
    email: "coach@example.com",
    password: "hunter2000",
    display_name: "Amahle Nkosi",
  });
});

test("shows a usable message instead of crashing on a real FastAPI 422 body", async () => {
  // The exact shape that used to crash the page (#51): detail is an array of
  // validation errors, not the hand-written {detail: "..."} every other test uses.
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(
    () =>
      new Response(
        JSON.stringify({
          detail: [{ loc: ["body", "display_name"], msg: "Field required", type: "missing" }],
        }),
        { status: 422 },
      ),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Field required");
  // A crash would unmount the whole tree, including the form itself.
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("navigates to / on a successful sign-up", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(() =>
    Response.json({ id: "1", email: "coach@example.com", display_name: "" }, { status: 201 }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("shows the server's error and stays on the password step when verification is missing", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Email verification required" }), { status: 400 }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Email verification required");
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("shows the retry wait and disables submit on a sign-up 429 response", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many sign-up attempts" }), {
        status: 429,
        headers: { "Retry-After": "10" },
      }),
  );

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many sign-up attempts Try again in 10s.",
  );
  expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
});

test("sends one POST /coaches however impatiently Sign Up is clicked", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  const respond = stubPendingFetch();

  await fillAndSubmitPassword(user);
  const submit = screen.getByRole("button", { name: "Sign Up" });
  expect(submit).toBeDisabled();
  await user.click(submit);

  // The second request would present a cookie the first one spent, so the account it
  // just created would come back as a 401 telling the coach to verify their email.
  expect(fetch).toHaveBeenCalledTimes(1);

  respond(
    Response.json({ id: "1", email: "coach@example.com", display_name: "" }, { status: 201 }),
  );
  expect(await screen.findByRole("heading", { name: "Sign In" })).toBeInTheDocument();
});

test("shows a generic error when the complete-sign-up request fails outright", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

  await fillAndSubmitPassword(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("starting over from the password step returns to the email step with the email preserved", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);

  await user.type(screen.getByLabelText("Password"), "newpassword1");
  await user.click(screen.getByRole("button", { name: "Start over" }));

  expect(await screen.findByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
});
