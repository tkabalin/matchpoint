import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayersPage } from "./players-page";

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

function renderPlayersPage() {
  // No provider from the app shell here — this page relies on __root.tsx supplying
  // one, so the test supplies its own, same as player-list.test.tsx.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayersPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the page heading and the roster", async () => {
  stubFetch(() => Response.json([]));

  renderPlayersPage();

  expect(screen.getByRole("heading", { name: "Players" })).toBeInTheDocument();
  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
});
