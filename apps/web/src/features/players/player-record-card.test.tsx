import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { PlayerRecordCard } from "./player-record-card";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlayerRecordCard playerId="player-1" />
    </QueryClientProvider>,
  );
}

test("shows the all-time win/loss record, no season row", async () => {
  renderCard();

  expect(await screen.findByText("Win/loss record")).toBeInTheDocument();
  expect(screen.getByText("All-time")).toBeInTheDocument();
  expect(screen.getByText("52–28")).toBeInTheDocument();
  expect(screen.queryByText("Season")).not.toBeInTheDocument();
  expect(screen.queryByText("14–6")).not.toBeInTheDocument();
});
