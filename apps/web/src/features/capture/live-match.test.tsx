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

test("back on setup exits the match entirely", async () => {
  const { onExit, user } = renderMatch();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onExit).toHaveBeenCalled();
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
  await user.click(await screen.findByRole("option", { name: surface }));
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

test("the rally screen's two questions can be answered in either order", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });

  // Outcome tapped first this time — the screen stays put until the length follows.
  await user.click(screen.getByRole("button", { name: "Win, forced error" }));
  expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Win, forced error" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(screen.getByRole("heading", { name: "Final shot" })).toBeVisible();
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

// The rally length used to live in its own piece of state, parked until commit — a let
// discarded the draft but not that state, so the abandoned rally's length silently
// carried into the replayed point (#5).
test("a let after picking a rally length doesn't carry it into the replayed point", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "3-5" }));

  await user.click(screen.getByRole("button", { name: "Let" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });

  expect(screen.getByRole("status")).toHaveTextContent("Pick the rally length and how it ended");
  expect(screen.getByRole("button", { name: "3-5" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Win, forced error" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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

// Regression: undoing the point's first screen once returns history to empty, which
// used to satisfy the same points.length === 0 check that opens setup on a fresh
// match — reopening a door that's supposed to have closed the moment the match queued.
test("once the match is queued, undoing back to the serve screen still can't reach setup", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();

  expect(screen.getByRole("button", { name: "Back, nothing to go back to" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
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

  // Skip ahead opens on release, not mid-hold (see match-header.tsx's onClick
  // comment for why), so the press has to actually outlast HOLD_MS before it lifts.
  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]" });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });

  // 6 games total keeps the default "Rivera serves next" consistent with firstServer.
  await user.clear(screen.getByLabelText("Rivera games"));
  await user.type(screen.getByLabelText("Rivera games"), "4");
  await user.clear(screen.getByLabelText("Okoye games"));
  await user.type(screen.getByLabelText("Okoye games"), "2");
  await user.click(screen.getByRole("button", { name: "Skip to score" }));

  const score = await screen.findByRole("table", { name: "Score" });
  expect(within(score).getByText("4")).toBeVisible();
  expect(within(score).getByText("2")).toBeVisible();
});

test("ending the match shows the result, with the reason it ended", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  // Skip ahead opens on release, not mid-hold (see match-header.tsx's onClick
  // comment for why), so the press has to actually outlast HOLD_MS before it lifts.
  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]" });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "End match" }));
  await user.click(screen.getByRole("radio", { name: /Retirement/ }));
  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Rivera" }));
  await user.click(screen.getByRole("button", { name: "Confirm end of match" }));

  expect(screen.getByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.getByText(/retirement/)).toBeVisible();
});

// A walkover/retirement declared before any point is captured used to write nothing
// to the outbox at all — matchQueued only ever fired off a point transition, and
// endMatch never touched the outbox itself.
test("declaring a walkover before the first point still queues the match and its outcome", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  // Skip ahead opens on release, not mid-hold (see match-header.tsx's onClick
  // comment for why), so the press has to actually outlast HOLD_MS before it lifts.
  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]" });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "End match" }));
  await user.click(screen.getByRole("radio", { name: /Walkover/ }));
  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Rivera" }));
  await user.click(screen.getByRole("button", { name: "Confirm end of match" }));

  expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(append).mock.calls[0]?.[0]).toMatchObject({ kind: "match" });
  expect(vi.mocked(append).mock.calls[1]?.[0]).toMatchObject({
    kind: "matchOutcome",
    matchId: vi.mocked(append).mock.calls[0]?.[0]?.matchId,
    payload: { reason: "walkover", trackedPlayerWon: true },
  });
});

// Once a point has queued the match row, that row is frozen (first-write-wins by
// id) — the outcome has to reach the outbox some other way, which is what the
// separate matchOutcome row is for.
test("retiring after points were played still queues the outcome, as its own row", async () => {
  const { user } = renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });
  vi.mocked(append).mockClear();

  // Skip ahead opens on release, not mid-hold (see match-header.tsx's onClick
  // comment for why), so the press has to actually outlast HOLD_MS before it lifts.
  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByRole("button", { name: "Skip point" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]" });
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Skip ahead" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "End match" }));
  await user.click(screen.getByRole("radio", { name: /Retirement/ }));
  const awardedTo = screen.getByRole("group", { name: "Match awarded to" });
  await user.click(within(awardedTo).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Confirm end of match" }));

  // The match row itself is not re-sent — it's already queued and the outbox
  // never rewrites it — only the new matchOutcome row goes out.
  expect(vi.mocked(append)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(append).mock.calls[0]?.[0]).toMatchObject({
    kind: "matchOutcome",
    payload: { reason: "retirement", trackedPlayerWon: false },
  });
});
