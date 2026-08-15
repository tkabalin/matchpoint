import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MatchesPage } from "./matches-page";

function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

function renderMatchesPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MatchesPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the page heading and the match list", async () => {
  stubFetch(() => Response.json([]));

  renderMatchesPage();

  expect(screen.getByRole("heading", { name: "Matches" })).toBeInTheDocument();
  expect(await screen.findByText("No matches yet.")).toBeInTheDocument();
});
