import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ServeTab } from "./serve-tab";

// A real failure needs its own file where the endpoint actually rejects — every
// other serve-tab test stubs a successful response, and stubGlobal is file-scoped.
afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows a load-failure message instead of an indefinite skeleton", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "boom" }), { status: 500 })),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServeTab playerId="player-1" />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Could not load serve stats.")).toBeInTheDocument();
});
