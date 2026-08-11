import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { PlayerList } from "./player-list";

const player = {
  id: "3f1c2b4e-0000-4000-8000-000000000001",
  first_name: "Amahle",
  last_name: "Nkosi",
  date_of_birth: null,
  dominant_hand: null,
  gender: null,
  notes: null,
  coach_id: null,
  archived_at: null,
  created_at: "2026-08-11T09:00:00Z",
  updated_at: "2026-08-11T09:00:00Z",
};

/** Stubs the transport rather than the generated client: the client is what's under test.
 *
 * Takes a factory, not a Response: a body can be read only once, so a single instance
 * handed to every call would resolve a second request in the same test — a refetch, or
 * a retry — with an unusable body rather than the fixture set up here.
 */
function stubFetch(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(response())),
  );
}

function renderPlayerList() {
  // retry off so the error path resolves in one attempt instead of on Query's backoff.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerList />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders the players the API returns", async () => {
  stubFetch(() => Response.json([player]));

  renderPlayerList();

  expect(await screen.findByText("Amahle Nkosi")).toBeInTheDocument();
});

test("requests the roster from the API's own origin", async () => {
  stubFetch(() => Response.json([]));

  renderPlayerList();

  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
  const [request] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(String(request instanceof Request ? request.url : request)).toContain("/api/players");
});

test("reports a failed load instead of rendering an empty roster", async () => {
  stubFetch(() => new Response("nope", { status: 500 }));

  renderPlayerList();

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load players.");
});
