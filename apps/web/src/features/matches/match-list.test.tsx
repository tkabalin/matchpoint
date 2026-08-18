import type { MatchRead } from "@matchpoint/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MatchList } from "./match-list";

// Annotated rather than inferred so tsc holds the fixture to the generated contract —
// same reasoning as player-list.test.tsx's player fixture.
const match: MatchRead = {
  id: "3f1c2b4e-0000-4000-8000-000000000002",
  player_id: "3f1c2b4e-0000-4000-8000-000000000001",
  opponent_name: "T. Naidoo",
  played_on: "2026-08-10",
  surface: "hard",
  event: null,
  scoring_system: "traditional",
  result: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/** Stubs the transport, not the component — same reasoning as player-list.test.tsx. */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

function renderMatchList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MatchList />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the matches the API returns", async () => {
  stubFetch(() => Response.json([match]));

  renderMatchList();

  expect(await screen.findByText("vs T. Naidoo")).toBeInTheDocument();
  expect(screen.getByText("Aug 10 · Hard")).toBeInTheDocument();
});

test("falls back to a placeholder for a match with no opponent name", async () => {
  stubFetch(() => Response.json([{ ...match, opponent_name: null }]));

  renderMatchList();

  expect(await screen.findByText("vs Unknown opponent")).toBeInTheDocument();
});

test("marks a finished match with its result", async () => {
  stubFetch(() => Response.json([{ ...match, result: "win" }]));

  renderMatchList();

  expect(await screen.findByText("W")).toBeInTheDocument();
});

test("shows an empty state when there are no matches", async () => {
  stubFetch(() => Response.json([]));

  renderMatchList();

  expect(await screen.findByText("No matches yet")).toBeInTheDocument();
});

test("reports a failed load instead of rendering an empty list", async () => {
  stubFetch(() => new Response("nope", { status: 500 }));

  renderMatchList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load matches.");
});
