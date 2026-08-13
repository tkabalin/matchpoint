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

test("sends the email to /api/auth/request-otp with cookies included", async () => {
  stubFetch(() => new Response(null, { status: 202 }));
  const user = userEvent.setup();
  await renderSignUp();

  await fillAndSubmitEmail(user);

  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe("/api/auth/request-otp");
  expect(init?.credentials).toBe("include");
  expect(JSON.parse(String(init?.body))).toEqual({ email: "coach@example.com" });
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

async function fillAndSubmitPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.type(screen.getByLabelText("Confirm password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Sign Up" }));
}

test("sends the email and password to POST /coaches with cookies included, no token field", async () => {
  const user = userEvent.setup();
  await goToPasswordStep(user);
  stubFetch(() =>
    Response.json({ id: "1", email: "coach@example.com", display_name: "" }, { status: 201 }),
  );

  await fillAndSubmitPassword(user);
  await screen.findByRole("heading", { name: "Sign In" });

  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe("/api/coaches");
  expect(init?.credentials).toBe("include");
  expect(JSON.parse(String(init?.body))).toEqual({
    email: "coach@example.com",
    password: "hunter2",
  });
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
