import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "@/app";

// The app shell mounts the roster, which fetches. Left unstubbed that is a real
// request out of the test run — it fails harmlessly, but slowly and off the network.
vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the app shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "MatchPoint" })).toBeInTheDocument();
});
