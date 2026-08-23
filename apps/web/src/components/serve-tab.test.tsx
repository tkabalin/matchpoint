import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { ServeTab } from "./serve-tab";

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServeTab playerId="player-1" />
    </QueryClientProvider>,
  );
}

test("both serve cards render, headline and stack visible, drills collapsed", async () => {
  renderTab();

  expect(await screen.findByText("Your serve")).toBeInTheDocument();
  expect(screen.getByText("Their serve")).toBeInTheDocument();
  expect(screen.getAllByText("1st serves in")).toHaveLength(2);
  expect(screen.queryByText("Fault mode")).not.toBeInTheDocument();
});

// The headline used to reuse `stats.hero.value` directly (68%), which double
// counted against the ace segment drawn right below it — the true in rate
// (in + ace) is 76%. Locks the fix in so the two numbers can't drift apart
// again without a test noticing.
test("the headline % in includes aces, not just the plain-in outcome bucket", async () => {
  renderTab();

  expect(await screen.findByText("76%")).toBeInTheDocument();
  expect(screen.getByText("69%")).toBeInTheDocument();
});

test("tapping a card's header opens its own drill without affecting the other card", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Your serve");

  await user.click(screen.getByText("Your serve"));

  expect(await screen.findByText("Fault mode")).toBeInTheDocument();
  expect(screen.queryByText("Their fault mode")).not.toBeInTheDocument();
});

test("both cards' drills can be open at the same time", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Your serve");

  await user.click(screen.getByText("Your serve"));
  await user.click(screen.getByText("Their serve"));

  expect(await screen.findByText("Fault mode")).toBeInTheDocument();
  expect(screen.getByText("Their fault mode")).toBeInTheDocument();
});

test("their serve's drill also shows your return outcome", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Their serve");

  await user.click(screen.getByText("Their serve"));

  expect(await screen.findByText("Your return outcome")).toBeInTheDocument();
});

test("switching 1st/2nd serve changes the fault-mode numbers shown", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Your serve");
  await user.click(screen.getByText("Your serve"));
  await screen.findByText("Fault mode");

  expect(screen.getByText("55%")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "2nd serve" }));

  expect(screen.getByText("38%")).toBeInTheDocument();
  expect(screen.queryByText("55%")).not.toBeInTheDocument();
});

// The hero and outcome stack used to stay frozen on the 1st-serve numbers no
// matter what the toggle said, so a coach reading "2nd serve" fault mode saw
// it sitting under a headline that was still describing the 1st serve.
test("switching 1st/2nd serve also updates the headline and outcome stack above it", async () => {
  const user = userEvent.setup();
  renderTab();
  await screen.findByText("Your serve");
  await user.click(screen.getByText("Your serve"));
  await screen.findByText("Fault mode");

  expect(screen.getAllByText("1st serves in")).toHaveLength(2);
  expect(screen.getByText("76%")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "2nd serve" }));

  expect(screen.getByText("2nd serves in")).toBeInTheDocument();
  expect(screen.getByText("88%")).toBeInTheDocument();
  expect(screen.queryByText("76%")).not.toBeInTheDocument();
});
