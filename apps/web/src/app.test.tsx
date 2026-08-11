import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "@/app";

// The app shell mounts the roster, which fetches. Left unstubbed that is a real
// request out of the test run — it fails harmlessly, but slowly and off the network.
//
// In beforeEach rather than at module scope: afterEach tears the stub down, so one
// installed at import would cover the first test in the file and no other. A fresh
// Response per call for the same reason the roster's own tests build one — a body
// reads once, and the App's QueryClient keeps the default retries.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the app shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "MatchPoint" })).toBeInTheDocument();
});
