import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { LiveMatch } from "./live-match";

// The outbox is IndexedDB; what matters here is that capture appends to it without
// waiting, which is asserted on the calls rather than on Dexie.
vi.mock("@/features/outbox/outbox", () => ({
  append: vi.fn(() => new Promise(() => {})),
}));
const { append } = await import("@/features/outbox/outbox");

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(append).mockClear();
});

function renderMatch() {
  const onExit = vi.fn();
  const onViewResults = vi.fn();
  render(
    <LiveMatch
      coachId={COACH_ID}
      trackedPlayerId={PLAYER_ID}
      playerName="Rivera"
      onExit={onExit}
      onViewResults={onViewResults}
    />,
  );
  return { onExit, onViewResults, user: userEvent.setup() };
}

async function startMatch(user: ReturnType<typeof renderMatch>["user"]) {
  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Start match" }));
}

test("setup comes first, and starting it opens the serve screen", async () => {
  const { user } = renderMatch();

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();

  await startMatch(user);

  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  expect(screen.getByRole("table", { name: "Score" })).toBeVisible();
});

test("the opponent serving first opens the return screen instead", async () => {
  const { user } = renderMatch();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Opponent" }));
  await user.click(screen.getByRole("button", { name: "Start match" }));

  expect(screen.getByRole("heading", { name: "Return" })).toBeVisible();
});

test.each([
  ["Grass", "var(--color-court-grass)"],
  ["Clay", "var(--color-court-clay)"],
  ["Carpet", "var(--color-court-carpet)"],
])("a %s match paints the court that surface", async (surface, expected) => {
  const { user } = renderMatch();

  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("combobox", { name: /Court type/ }));
  await user.click(screen.getByRole("option", { name: surface }));
  await user.click(screen.getByRole("button", { name: "Start match" }));

  const court = screen.getByRole("button", { name: "Deuce service box" }).closest("div[style]");
  expect(court?.closest("[style*='--court-surface']")).toHaveStyle({
    "--court-surface": expected,
  });
});

test("a hard court keeps the default green, with nothing to override it", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  expect(document.querySelector("[style*='--court-surface']")).toBeNull();
});

test("a point threads serve to final ball and lands on the scoreboard", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "3-5" }));
  await user.click(screen.getByRole("button", { name: "Win, forced error" }));

  expect(screen.getByRole("heading", { name: "Final shot" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Forehand drive" }));

  expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Deuce deep" }));

  // Back to a fresh serve, with the point on the board as 15-0.
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });
  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test("an unforced error skips the shot screen", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "1-2" }));
  await user.click(screen.getByRole("button", { name: "Loss, unforced error" }));

  expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
});

test("back on the match's first screen returns to setup, still holding what was typed", async () => {
  const { user } = renderMatch();
  await startMatch(user);
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();
  expect(screen.getByLabelText("Opponent")).toHaveValue("Okoye");
});

test("nothing is queued while setup is still reachable", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  expect(vi.mocked(append)).not.toHaveBeenCalled();

  // Leaving the serve screen is the moment the match stops being editable.
  await user.click(screen.getByRole("button", { name: "Deuce service box" }));

  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(1);
  });
  expect(vi.mocked(append).mock.calls[0]?.[0]).toMatchObject({ kind: "match" });
});

test("back walks the point's screens, and stops at the serve", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});

test("once a point is recorded there is no way back into it", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });

  // Still on screen, so the header keeps its shape, but no longer an offer.
  expect(screen.getByRole("button", { name: "Back, nothing to go back to" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
});

test("the committed point is queued behind its match, and never awaited", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  // An ace is the shortest whole point: one tap, straight to READY.
  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });

  expect(vi.mocked(append).mock.calls[0]?.[0]).toMatchObject({ kind: "match" });
  expect(vi.mocked(append).mock.calls[1]?.[0]).toMatchObject({
    kind: "point",
    coachId: COACH_ID,
  });
});

test("a skipped point is recorded winner-only and moves the score", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test("skipping ahead resumes from the score the coach entered", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });
  await user.pointer({ keys: "[/MouseLeft]" });

  await user.clear(screen.getByLabelText("Rivera games"));
  await user.type(screen.getByLabelText("Rivera games"), "4");
  await user.clear(screen.getByLabelText("Okoye games"));
  await user.type(screen.getByLabelText("Okoye games"), "3");
  await user.click(screen.getByRole("button", { name: "Skip to score" }));

  const score = await screen.findByRole("table", { name: "Score" });
  expect(within(score).getByText("4")).toBeVisible();
  expect(within(score).getByText("3")).toBeVisible();
});

test("ending the match shows the result, with the reason it ended", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });
  await user.pointer({ keys: "[/MouseLeft]" });

  await user.click(screen.getByRole("button", { name: "End match" }));
  await user.click(screen.getByRole("radio", { name: /Retirement/ }));
  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Rivera" }));
  await user.click(screen.getByRole("button", { name: "Confirm end of match" }));

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText(/retirement/)).toBeVisible();
});
