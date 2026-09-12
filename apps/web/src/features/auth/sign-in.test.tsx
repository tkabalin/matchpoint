import { zLoginBody, zPlayerLoginBody } from "@matchpoint/api-client/zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { outboxDb } from "@/features/outbox/db";
import { append, readPending } from "@/features/outbox/outbox";
import { purgeIfOwnerChanged } from "@/lib/local-data";

import { SignIn } from "./sign-in";

const COACH_ID = "c0ac0000-0000-4000-8000-000000000001";
const OTHER_COACH_ID = "c0ac0000-0000-4000-8000-000000000002";
const PLAYER_ID = "31aye000-0000-4000-8000-000000000001";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx:
 * a factory, not a shared Response, since a body can only be read once. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

/** Renders SignIn inside a real (in-memory) router rather than mocking useNavigate,
 * so a successful sign-in is verified by what actually ends up on screen. Awaits the
 * initial route match settling — RouterProvider renders nothing until then, so a
 * synchronous query right after `render` finds an empty document. */
async function renderSignIn() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: SignIn });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/home",
    component: () => <h1>Home</h1>,
  });
  const meRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me",
    component: () => <h1>Me</h1>,
  });
  const signUpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-up",
    component: () => <h1>Sign Up</h1>,
  });
  const forgotPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/forgot-password",
    component: () => <h1>Reset Password</h1>,
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    homeRoute,
    meRoute,
    signUpRoute,
    forgotPasswordRoute,
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // A QueryClientProvider because a successful sign-in clears the cache the previous
  // owner on this device left behind, and the client is what holds the in-memory half.
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Sign In" });
}

/** The coach the stubbed login signs in, whoever the device belonged to before. */
function loginResponse(id: string) {
  return () => Response.json({ id, email: "coach@example.com", display_name: "Coach" });
}

/** A point captured on this device and never sent, of the given owner's. */
function queuePoint(ownerId: string) {
  return append({
    id: `3f1c2b4e-0000-4000-8000-0000000000${ownerId.slice(-2)}`,
    coachId: ownerId,
    matchId: "3f1c2b4e-0000-4000-8000-000000000001",
    kind: "point",
    payload: { rallyLength: 4 },
  });
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  identifier = "coach@example.com",
  password = "hunter2",
) {
  await user.type(screen.getByLabelText("Email or username"), identifier);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign In" }));
}

beforeEach(async () => {
  localStorage.clear();
  await outboxDb.delete();
  await outboxDb.open();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("renders the identifier and password fields", async () => {
  await renderSignIn();

  expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("updates the fields as the user types", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await user.type(screen.getByLabelText("Email or username"), "coach@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");

  expect(screen.getByLabelText("Email or username")).toHaveValue("coach@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("hunter2");
});

test("blocks submit until both fields are filled", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  const submit = screen.getByRole("button", { name: "Sign In" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email or username"), "coach@example.com");
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Password"), "hunter2");
  expect(submit).toBeEnabled();
});

test("navigates to /home on a successful coach sign-in", async () => {
  stubFetch(() => Response.json({ id: "1", email: "coach@example.com", display_name: "Coach" }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test("sends the credentials to /api/auth/login when the identifier has an @", async () => {
  stubFetch(() => Response.json({ id: "1", email: "coach@example.com", display_name: "Coach" }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);
  await screen.findByRole("heading", { name: "Home" });

  // The generated client calls fetch with a single Request object, not (url, init) —
  // same pattern player-list.test.tsx uses for the same reason.
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/login");
  const body = await realRequest.json();
  // The schema comes from the API's spec, the literal below from this test. Only the
  // first can tell us the API would accept this body (see docs/testing.md).
  expect(zLoginBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({
    email: "coach@example.com",
    password: "hunter2",
  });
});

test("shows the server's error message on a failed coach sign-in", async () => {
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Incorrect email or password" }), { status: 401 }),
  );
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
});

test("falls back to an explicit message when the coach response has no detail to show", async () => {
  stubFetch(() => new Response(JSON.stringify({}), { status: 500 }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't sign you in. Check your email and password and try again.",
  );
});

test("shows the retry wait and disables submit on a 429 response", async () => {
  // The countdown's tick-by-tick behavior is covered by use-countdown.test.ts's own
  // unit tests — this only needs to prove a 429 wires the header into the UI at all.
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Too many attempts" }), {
        status: 429,
        headers: { "Retry-After": "3" },
      }),
  );
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts Try again in 3s.");
  expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("links to the sign-up page", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await user.click(screen.getByRole("link", { name: "Create account" }));

  expect(await screen.findByRole("heading", { name: "Sign Up" })).toBeInTheDocument();
});

test("links to the forgot-password page", async () => {
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await user.click(screen.getByRole("link", { name: "Forgot password?" }));

  expect(await screen.findByRole("heading", { name: "Reset Password" })).toBeInTheDocument();
});

test("wipes what the previous owner left when a different coach signs in", async () => {
  // What a previous sign-in on this device would have left: the ownership record and
  // that coach's queue. #117 requires both gone before the first screen renders.
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint(COACH_ID);
  stubFetch(loginResponse(OTHER_COACH_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  expect(await readPending(COACH_ID)).toHaveLength(0);
});

test("keeps the queue when the same coach signs in again", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint(COACH_ID);
  stubFetch(loginResponse(COACH_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  // The way back from a session the server revoked: the points captured before it
  // died are still on the device, waiting for a drain (#117).
  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  expect(await readPending(COACH_ID)).toHaveLength(1);
});

test("refuses a coach 200 that names no coach rather than signing in as nobody", async () => {
  stubFetch(() => new Response(null, { status: 200 }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user);

  // Without an id there is no telling whose device this now is, so the purge cannot
  // run. The session the server did mint is ended, or a reload of a protected route
  // would walk straight in on the previous owner's cache.
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't tell who you are");
  expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("keeps the coach on the form when this device cannot be cleared", async () => {
  stubFetch(loginResponse(OTHER_COACH_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();
  // What a browser with storage blocked does. Signing in anyway would hand this coach
  // a device still holding the previous one's data, which is the leak #117 closes.
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Close any other MatchPoint tabs");
  expect(screen.queryByRole("heading", { name: "Home" })).not.toBeInTheDocument();
});

// #203: a bare username (no "@") routes to the player endpoint instead — the same
// form, the same fields, a different wire call and a different landing.
function playerLoginResponse(id: string) {
  return () =>
    Response.json({ id, username: "nksama001", first_name: "Amahle", last_name: "Nkosi" });
}

test("navigates to /me on a successful player sign-in", async () => {
  stubFetch(playerLoginResponse(PLAYER_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "onetimepass");

  expect(await screen.findByRole("heading", { name: "Me" })).toBeInTheDocument();
});

test("sends the credentials to /api/auth/player/login when the identifier has no @", async () => {
  stubFetch(playerLoginResponse(PLAYER_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "onetimepass");
  await screen.findByRole("heading", { name: "Me" });

  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/player/login");
  const body = await realRequest.json();
  expect(zPlayerLoginBody.safeParse(body).error).toBeUndefined();
  expect(body).toEqual({
    username: "nksama001",
    password: "onetimepass",
  });
});

test("shows the server's error message on a failed player sign-in", async () => {
  stubFetch(
    () =>
      new Response(JSON.stringify({ detail: "Incorrect username or password" }), { status: 401 }),
  );
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "wrong");

  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password");
});

test("falls back to a username-specific message when the player response has no detail", async () => {
  stubFetch(() => new Response(JSON.stringify({}), { status: 500 }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "onetimepass");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't sign you in. Check your username and password and try again.",
  );
});

test("refuses a player 200 that names no player rather than signing in as nobody", async () => {
  stubFetch(() => new Response(null, { status: 200 }));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "onetimepass");

  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't tell who you are");
  expect(screen.queryByRole("heading", { name: "Me" })).not.toBeInTheDocument();
  // login + playerLogout, mirroring the coach branch's login + logout guard.
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("wipes what a previous coach left when a player signs in on the same device", async () => {
  await purgeIfOwnerChanged(COACH_ID, new QueryClient(), "coach");
  await queuePoint(COACH_ID);
  stubFetch(playerLoginResponse(PLAYER_ID));
  const user = userEvent.setup({ delay: null });
  await renderSignIn();

  await fillAndSubmit(user, "nksama001", "onetimepass");

  expect(await screen.findByRole("heading", { name: "Me" })).toBeInTheDocument();
  expect(await readPending(COACH_ID)).toHaveLength(0);
});
