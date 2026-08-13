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

import { SignIn } from "./sign-in";

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
  const signUpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-up",
    component: () => <h1>Sign Up</h1>,
  });
  const routeTree = rootRoute.addChildren([indexRoute, homeRoute, signUpRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Sign In" });
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Sign In" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the email and password fields", async () => {
  await renderSignIn();

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("updates the fields as the user types", async () => {
  const user = userEvent.setup();
  await renderSignIn();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");

  expect(screen.getByLabelText("Email")).toHaveValue("coach@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("hunter2");
});

test("blocks submit until both fields are filled", async () => {
  const user = userEvent.setup();
  await renderSignIn();

  const submit = screen.getByRole("button", { name: "Sign In" });
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Email"), "coach@example.com");
  expect(submit).toBeDisabled();

  await user.type(screen.getByLabelText("Password"), "hunter2");
  expect(submit).toBeEnabled();
});

test("navigates to /home on a successful sign-in", async () => {
  stubFetch(() => Response.json({ id: "1", email: "coach@example.com", display_name: "Coach" }));
  const user = userEvent.setup();
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
});

test("sends the credentials to /api/auth/login", async () => {
  stubFetch(() => Response.json({ id: "1", email: "coach@example.com", display_name: "Coach" }));
  const user = userEvent.setup();
  await renderSignIn();

  await fillAndSubmit(user);
  await screen.findByRole("heading", { name: "Home" });

  // The generated client calls fetch with a single Request object, not (url, init) —
  // same pattern player-list.test.tsx uses for the same reason.
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(request).toBeInstanceOf(Request);
  const realRequest = request as Request;
  expect(realRequest.url).toContain("/api/auth/login");
  expect(await realRequest.json()).toEqual({
    email: "coach@example.com",
    password: "hunter2",
  });
});

test("shows the server's error message on a failed sign-in", async () => {
  stubFetch(
    () => new Response(JSON.stringify({ detail: "Incorrect email or password" }), { status: 401 }),
  );
  const user = userEvent.setup();
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
});

test("shows a generic error when the request fails outright", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  const user = userEvent.setup();
  await renderSignIn();

  await fillAndSubmit(user);

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

test("links to the sign-up page", async () => {
  const user = userEvent.setup();
  await renderSignIn();

  await user.click(screen.getByRole("link", { name: "sign up here" }));

  expect(await screen.findByRole("heading", { name: "Sign Up" })).toBeInTheDocument();
});
