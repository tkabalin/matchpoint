import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { RecentFormRow } from "./recent-form-row";

function renderRow(opponentId: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RecentFormRow playerId="player-1" opponentId={opponentId} />
    </QueryClientProvider>,
  );
  return queryClient;
}

test("shows the all-matches record when no opponent is scoped", async () => {
  renderRow(null);

  expect(await screen.findByText("Recent form · last 5")).toBeInTheDocument();
  expect(screen.getByText("4W – 1L")).toBeInTheDocument();
});

// `aria-label` on a bare `<span>` isn't announced by most screen readers — no
// role means no accessible name is exposed. `role="img"` is what makes it one.
test("each result dot is announced as Won or Lost, not just shown by fill", async () => {
  renderRow(null);
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

test("scopes the record and label to the chosen opponent", async () => {
  renderRow("sarah-k");

  expect(await screen.findByText("Recent form · last 5 vs Sarah K")).toBeInTheDocument();
  expect(screen.getByText("3W – 2L")).toBeInTheDocument();
});

// Most of `OPPONENTS` don't have a matching fixture yet. The row used to fall
// back to the all-matches record and label it under that opponent's name
// anyway — mislabelling someone else's numbers. Hiding is the honest result.
test("renders nothing for an opponent with no recent-form fixture, rather than mislabelling the all-matches record", async () => {
  const queryClient = renderRow("alex-t");

  await waitFor(() => {
    const state = queryClient.getQueryState(["analytics", "recent-form", "player-1", "alex-t"]);
    expect(state?.status).toBe("success");
  });
  expect(screen.queryByText(/Recent form/)).not.toBeInTheDocument();
});
