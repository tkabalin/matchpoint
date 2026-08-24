import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { PlayerRecordCard } from "./player-record-card";

function renderCard(opponentId: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerRecordCard playerId="player-1" opponentId={opponentId} />
    </QueryClientProvider>,
  );
  return queryClient;
}

test("shows the all-time win/loss record, no season row", async () => {
  renderCard();

  expect(await screen.findByText("Win/loss record")).toBeInTheDocument();
  expect(screen.getByText("All-time")).toBeInTheDocument();
  expect(screen.getByText("52W – 28L")).toBeInTheDocument();
  expect(screen.queryByText("Season")).not.toBeInTheDocument();
  expect(screen.queryByText("14W – 6L")).not.toBeInTheDocument();
});

test("shows recent form in the same card, all-matches by default", async () => {
  renderCard();

  expect(await screen.findByText("Recent form · last 5")).toBeInTheDocument();
  expect(screen.getByText("4W – 1L")).toBeInTheDocument();
});

// `aria-label` on a bare `<span>` isn't announced by most screen readers — no
// role means no accessible name is exposed. `role="img"` is what makes it one.
test("each result dot is announced as Won or Lost, not just shown by fill", async () => {
  renderCard();
  await screen.findByText("Recent form · last 5");

  const dots = screen.getAllByRole("img");
  expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
    "Won",
    "Won",
    "Lost",
    "Won",
    "Won",
  ]);
});

test("scopes recent form to the chosen opponent", async () => {
  renderCard("sarah-k");

  expect(await screen.findByText("Recent form · last 5 vs Sarah K")).toBeInTheDocument();
  expect(screen.getByText("3W – 2L")).toBeInTheDocument();
});

// Most of `OPPONENTS` don't have a matching fixture yet. Silently falling back
// to the all-matches record under that opponent's name would mislabel it, so
// the card hides the recent-form block entirely instead.
test("hides recent form for an opponent with no fixture, rather than mislabelling the all-matches record", async () => {
  const queryClient = renderCard("alex-t");

  await waitFor(() => {
    const state = queryClient.getQueryState(["analytics", "recent-form", "player-1", "alex-t"]);
    expect(state?.status).toBe("success");
  });
  expect(screen.queryByText(/Recent form/)).not.toBeInTheDocument();
});
