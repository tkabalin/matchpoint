import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { outboxDb } from "@/features/outbox/db";

import { LiveMatch } from "./live-match";

// The outbox is IndexedDB; what matters here is that capture appends to it without
// waiting, which is asserted on the calls rather than on Dexie.
vi.mock("@/features/outbox/outbox", () => ({
  append: vi.fn(() => new Promise(() => {})),
  remove: vi.fn(() => new Promise(() => {})),
}));
const { append } = await import("@/features/outbox/outbox");

// The sync status indicator has its own test file; stubbed here so this file's mock of
// outbox.ts (above) doesn't have to shadow every export that component reads.
vi.mock("@/components/sync-status", () => ({
  SyncStatus: () => null,
}));

const COACH_ID = "3f1c2b4e-0000-4000-8000-0000000000c1";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";

beforeEach(async () => {
  vi.mocked(append).mockClear();
  // The log is real (fake-indexeddb), and it outlives a test unless it is cleared:
  // otherwise the next render resumes the previous test's match.
  await outboxDb.events.clear();
  await outboxDb.matches.clear();
});

/**
 * Renders and waits for the first paint. Capture asks the log whether this player has
 * a match still running before it draws anything, so nothing is on screen until that
 * answer lands — on either the setup screen or the match it resumed.
 */
async function renderMatch() {
  const onExit = vi.fn();
  const onGoHome = vi.fn();
  const onViewResults = vi.fn();
  const view = render(
    <LiveMatch
      coachId={COACH_ID}
      trackedPlayerId={PLAYER_ID}
      playerName="Rivera"
      onExit={onExit}
      onGoHome={onGoHome}
      onViewResults={onViewResults}
    />,
  );
  await waitFor(() => {
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
  return { ...view, onExit, onGoHome, onViewResults, user: userEvent.setup({ delay: null }) };
}

/** Holds past HOLD_MS and lets go, the gesture that reaches a button's hold action. */
async function holdAndRelease(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  await user.pointer({ keys: "[MouseLeft>]", target });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await user.pointer({ keys: "[/MouseLeft]", target });
}

async function startMatch(user: Awaited<ReturnType<typeof renderMatch>>["user"]) {
  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("button", { name: "Start match" }));
}

test("setup comes first, and starting it opens the serve screen", async () => {
  const { user } = await renderMatch();

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();

  await startMatch(user);

  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  expect(screen.getByRole("table", { name: "Score" })).toBeVisible();
});

test("back on setup exits the match entirely", async () => {
  const { onExit, user } = await renderMatch();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onExit).toHaveBeenCalled();
});

test("the opponent serving first opens the return screen instead", async () => {
  const { user } = await renderMatch();

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
  const { user } = await renderMatch();

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
  const { user } = await renderMatch();
  await startMatch(user);

  expect(document.querySelector("[style*='--court-surface']")).toBeNull();
});

test("a point threads serve to final ball and lands on the scoreboard", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });

  // Finished on the opponent's half, so Rivera won it.
  await user.click(screen.getByRole("button", { name: "Okoye: deuce deep" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally length" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "3-5" }));

  expect(screen.getByRole("heading", { name: "How it ended" })).toBeVisible();
  expect(screen.getByText("Point to Rivera")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^Forced/ }));

  expect(screen.getByRole("heading", { name: "Final shot" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Forehand drive" }));

  // Back to a fresh serve, with the point on the board as 15-0.
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });
  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test("a ball finishing on our half is a point lost", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "Rivera: ad short" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally length" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "1-2" }));

  expect(screen.getByText("Point to Okoye")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^Unforced/ }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });
  const point = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point")?.[0];
  expect(point?.payload).toMatchObject({
    won: false,
    endReason: "MISTAKE",
    ballIn: true,
    ballLocation: { half: "AD", depth: "SHORT" },
    rallyLengthBucket: "B1",
  });
  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test("an unforced error skips the shot screen", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "Okoye: deuce deep" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally length" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "1-2" }));
  await user.click(screen.getByRole("button", { name: /^Unforced/ }));

  // Straight back to the next serve: no shot screen in between.
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });
  const point = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point")?.[0];
  expect(point?.payload).toMatchObject({ won: true, endReason: "MISTAKE", wing: null });
});

test("a let from the final ball replays the point from the first serve", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Let" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
  });
  // Nothing scored, and the replayed point starts from nothing.
  expect(vi.mocked(append).mock.calls.some((call) => call[0].kind === "point")).toBe(false);
});

test("a point the coach only half-saw is kept, not discarded", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  // Missed the serve, then missed how it ended too.
  await user.click(screen.getByRole("button", { name: "Didn't see" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "Didn't see" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  const point = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point")?.[0];
  expect(point?.payload).toMatchObject({
    won: true,
    serves: [],
    endReason: null,
    rallyLengthBucket: null,
  });
  // And the score moved, which is the whole point of keeping it.
  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test("a missed stroke still records where the ball landed", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "Okoye: deuce deep" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Rally length" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "3-5" }));
  await user.click(screen.getByRole("button", { name: /^Forced/ }));
  await user.click(screen.getByRole("button", { name: "Didn't see the shot" }));

  await waitFor(() => {
    expect(vi.mocked(append).mock.calls.some((call) => call[0].kind === "point")).toBe(true);
  });
  const point = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point")?.[0];
  expect(point?.payload).toMatchObject({
    wing: null,
    shotType: null,
    ballIn: true,
    endReason: "FORCED",
  });
});

test("the skip sheet points at the editor when the gap is bigger than one point", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(
    screen.getByRole("button", { name: "Missed more than one point? Set the score" }),
  );

  expect(await screen.findByRole("heading", { name: "Score" })).toBeVisible();
});

test("back on the match's first screen returns to setup, still holding what was typed", async () => {
  const { user } = await renderMatch();
  await startMatch(user);
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();
  expect(screen.getByLabelText("Opponent")).toHaveValue("Okoye");
});

test("nothing is queued while setup is still reachable", async () => {
  const { user } = await renderMatch();
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
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});

// Regression: undoing the point's first screen once returns history to empty, which
// used to satisfy the same points.length === 0 check that opens setup on a fresh
// match — reopening a door that's supposed to have closed the moment the match queued.
test("once the match is queued, undoing back to the serve screen leaves rather than reaching setup", async () => {
  const { onExit, user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Deuce service box" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Final ball" })).toBeVisible();
  });

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();

  // Nothing was captured, so the coach isn't held in a match they can't back out of:
  // Back leaves, and the queued match row is deleted from the match list instead.
  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(onExit).toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Match" })).not.toBeInTheDocument();
});

test("back past a recorded point offers to undo it, and asks first", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });

  await user.click(screen.getByRole("button", { name: "Back" }));

  expect(screen.getByRole("heading", { name: "Undo the last point?" })).toBeVisible();
});

test("holding back goes home outright, bypassing the undo prompt entirely", async () => {
  const { onGoHome, user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });

  await holdAndRelease(user, screen.getByRole("button", { name: "Back" }));

  expect(onGoHome).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", { name: "Undo the last point?" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});

test("undoing takes the point back off the score and queues its delete", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  const score = screen.getByRole("table", { name: "Score" });
  await waitFor(() => {
    expect(within(score).getByText("15")).toBeVisible();
  });
  const pointRow = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point");

  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));

  await waitFor(() => {
    expect(within(screen.getByRole("table", { name: "Score" })).queryByText("15")).toBeNull();
  });
  // "Not in the outbox" is not "not on the server", so the delete goes out either way.
  expect(vi.mocked(append).mock.calls.map((call) => call[0])).toContainEqual(
    expect.objectContaining({
      id: `${String(pointRow?.[0].id)}:delete`,
      kind: "eventDelete",
      payload: { kind: "point" },
    }),
  );
});

test("a mis-tapped match point can be undone from the result screen itself", async () => {
  const { user } = await renderMatch();
  // A pro set is one set to 8 games, so a single skipped point can finish the match.
  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("combobox", { name: /Scoring system/ }));
  await user.click(await screen.findByRole("option", { name: "Pro Set" }));
  await user.click(screen.getByRole("button", { name: "Start match" }));

  await openScoreSheet(user);
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "7");
  await user.click(screen.getByRole("button", { name: "Rivera 40" }));
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await user.click(await screen.findByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));
  expect(await screen.findByRole("heading", { name: "Win" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Undo last point" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));

  // Back in the match, with the match-deciding point gone.
  expect(await screen.findByRole("button", { name: "Skip point" })).toBeVisible();
  expect(vi.mocked(append).mock.calls.some((call) => call[0].kind === "matchOutcome")).toBe(false);
});

test("a tab that dies mid-match reopens at the same score", async () => {
  const first = await renderMatch();
  await startMatch(first.user);
  await first.user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });
  first.unmount();

  await renderMatch();

  // Folded again from the log, not from anything that was held in memory.
  const score = await screen.findByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
  expect(screen.getByRole("heading", { name: "1st Serve" })).toBeVisible();
});

test("a resumed match keeps counting from where its sequence left off", async () => {
  const first = await renderMatch();
  await startMatch(first.user);
  await first.user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });
  first.unmount();
  vi.mocked(append).mockClear();

  const second = await renderMatch();
  await second.user.click(screen.getByRole("button", { name: "Ace" }));

  await waitFor(() => {
    expect(vi.mocked(append).mock.calls.some((call) => call[0].kind === "point")).toBe(true);
  });
  const point = vi.mocked(append).mock.calls.find((call) => call[0].kind === "point")?.[0];
  expect(point?.payload).toMatchObject({ sequence: 1 });
});

test("a logged event this build cannot read leaves the coach on setup, told why", async () => {
  const first = await renderMatch();
  await startMatch(first.user);
  await first.user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });
  first.unmount();

  // What an app update can leave behind: a payload an earlier build wrote that this
  // one's fromJSON refuses. Log rows carry no schemaVersion, so it is only found here.
  const logged = await outboxDb.events.toArray();
  expect(logged.length).toBeGreaterThan(0);
  await outboxDb.events.bulkPut(logged.map((row) => ({ ...row, payload: { won: "maybe" } })));

  render(
    <>
      <Toaster />
      <LiveMatch
        coachId={COACH_ID}
        trackedPlayerId={PLAYER_ID}
        playerName="Rivera"
        onExit={vi.fn()}
        onGoHome={vi.fn()}
        onViewResults={vi.fn()}
      />
    </>,
  );

  expect(await screen.findByRole("heading", { name: "Match" })).toBeVisible();
  expect(
    await screen.findByText(
      "That match could not be reopened on this device. You can start a new one.",
    ),
  ).toBeVisible();
});

test("a finished match is not resumed into", async () => {
  const first = await renderMatch();
  await first.user.type(screen.getByLabelText("Opponent"), "Okoye");
  await first.user.click(screen.getByRole("combobox", { name: /Scoring system/ }));
  await first.user.click(await screen.findByRole("option", { name: "Pro Set" }));
  await first.user.click(screen.getByRole("button", { name: "Start match" }));

  await openScoreSheet(first.user);
  await first.user.clear(screen.getByLabelText("Rivera set 1 games"));
  await first.user.type(screen.getByLabelText("Rivera set 1 games"), "7");
  await first.user.click(screen.getByRole("button", { name: "Rivera 40" }));
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await first.user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  await first.user.click(screen.getByRole("button", { name: "Set score" }));
  await first.user.click(await screen.findByRole("button", { name: "Skip point" }));
  await first.user.click(screen.getByRole("button", { name: /Win/ }));
  await first.user.click(await screen.findByRole("button", { name: "Finish match" }));
  first.unmount();

  await renderMatch();

  expect(screen.getByRole("heading", { name: "Match" })).toBeVisible();
});

test("the score the coach enters is queued as its own event, not as invented points", async () => {
  const { user } = await renderMatch();
  await startMatch(user);
  await openScoreSheet(user);

  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "4");
  await user.clear(screen.getByLabelText("Okoye set 1 games"));
  await user.type(screen.getByLabelText("Okoye set 1 games"), "2");
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await waitFor(() => {
    expect(vi.mocked(append).mock.calls.map((call) => call[0].kind)).toEqual([
      "match",
      "checkpoint",
    ]);
  });
  const checkpoint = vi.mocked(append).mock.calls[1]?.[0];
  expect(checkpoint?.payload).toMatchObject({
    after: { sets: [{ tracked: 4, opponent: 2 }] },
    servesNext: "TRACKED",
    orderChanged: false,
  });
});

test("an out-of-turn game on court is recordable rather than a dead end", async () => {
  const { user } = await renderMatch();
  await startMatch(user);
  await user.click(screen.getByRole("button", { name: "Ace" }));
  await openScoreSheet(user);

  // One game played means game 2 is Okoye's, so "Rivera serves next" disagrees.
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "1");
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Rivera" }));

  expect(screen.getByText(/serving order changed on court/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Set score" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "The order changed on court" }));

  expect(screen.getByRole("button", { name: "Set score" })).toBeEnabled();
});

test("finishing a match won on sets queues its completion, which nothing else does", async () => {
  const { user } = await renderMatch();
  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("combobox", { name: /Scoring system/ }));
  await user.click(await screen.findByRole("option", { name: "Pro Set" }));
  await user.click(screen.getByRole("button", { name: "Start match" }));

  await openScoreSheet(user);
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "7");
  await user.click(screen.getByRole("button", { name: "Rivera 40" }));
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await user.click(await screen.findByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));
  expect(await screen.findByRole("heading", { name: "Win" })).toBeVisible();
  expect(vi.mocked(append).mock.calls.some((call) => call[0].kind === "matchOutcome")).toBe(false);

  await user.click(screen.getByRole("button", { name: "Finish match" }));

  expect(vi.mocked(append).mock.calls.map((call) => call[0])).toContainEqual(
    expect.objectContaining({
      kind: "matchOutcome",
      payload: { reason: "completed", trackedPlayerWon: true },
    }),
  );
});

test("the committed point is queued behind its match, and never awaited", async () => {
  const { user } = await renderMatch();
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
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  const score = screen.getByRole("table", { name: "Score" });
  expect(within(score).getByText("15")).toBeVisible();
});

test.each([
  ["Win", "Point won"],
  ["Loss", "Point lost"],
])("recording a point as a %s flashes %s", async (outcome, flashed) => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: new RegExp(outcome) }));

  expect(screen.getByText(flashed)).toBeVisible();
});

test("the flash clears itself rather than sitting over the next point", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));
  expect(screen.getByText("Point won")).toBeVisible();

  // Real timers: the duration is ScoreFlash's own (score-flash.test.tsx); this is the
  // screen's side of the hand-off, that its onDone takes the flash down.
  await waitFor(() => {
    expect(screen.queryByText("Point won")).not.toBeInTheDocument();
  });
});

/** Tapping the score opens the editor; the hold gesture is match-header.test.tsx's. */
async function openScoreSheet(user: Awaited<ReturnType<typeof renderMatch>>["user"]) {
  await user.click(screen.getByRole("button", { name: "Edit score" }));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Score" })).toBeVisible();
  });
}

test("a point that takes the game flashes the game, not the point", async () => {
  const { user } = await renderMatch();
  await startMatch(user);
  await openScoreSheet(user);

  // 40-0 in the opening game: the next point takes it.
  await user.click(screen.getByRole("button", { name: "Rivera 40" }));
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await user.click(await screen.findByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  expect(screen.getByText("Game won")).toBeVisible();
  expect(screen.queryByText("Point won")).not.toBeInTheDocument();
});

test("a point that takes the set flashes the set", async () => {
  const { user } = await renderMatch();
  await startMatch(user);
  await openScoreSheet(user);

  // 5-0, 40-0: the next point takes the sixth game and the set. Rivera served the odd
  // games, so the sixth is Okoye's.
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "5");
  await user.click(screen.getByRole("button", { name: "Rivera 40" }));
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await user.click(await screen.findByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  expect(screen.getByText("Set won")).toBeVisible();
});

test("the point that ends the match doesn't flash over the result screen", async () => {
  const { user } = await renderMatch();
  // A pro set is one set to 8 games, so a single skipped point can finish the match.
  await user.type(screen.getByLabelText("Opponent"), "Okoye");
  await user.click(screen.getByRole("combobox", { name: /Scoring system/ }));
  await user.click(await screen.findByRole("option", { name: "Pro Set" }));
  await user.click(screen.getByRole("button", { name: "Start match" }));
  await openScoreSheet(user);

  // 7-0, 40-0: one more point takes the eighth game and the match with it. Rivera
  // served the odd games, so the eighth is Okoye's.
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "7");
  await user.click(screen.getByRole("button", { name: "Rivera 40" }));
  const servingNext = screen.getByRole("group", { name: "Serving next" });
  await user.click(within(servingNext).getByRole("button", { name: "Okoye" }));
  await user.click(screen.getByRole("button", { name: "Set score" }));

  await user.click(await screen.findByRole("button", { name: "Skip point" }));
  await user.click(screen.getByRole("button", { name: /Win/ }));

  expect(await screen.findByRole("heading", { name: "Win" })).toBeVisible();
  expect(screen.queryByText(/^Point (won|lost)$/)).not.toBeInTheDocument();
});

test("skipping ahead resumes from the score the coach entered", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await openScoreSheet(user);

  // 6 games total keeps the default "Rivera serves next" consistent with firstServer.
  await user.clear(screen.getByLabelText("Rivera set 1 games"));
  await user.type(screen.getByLabelText("Rivera set 1 games"), "4");
  await user.clear(screen.getByLabelText("Okoye set 1 games"));
  await user.type(screen.getByLabelText("Okoye set 1 games"), "2");
  await user.click(screen.getByRole("button", { name: "Set score" }));

  const score = await screen.findByRole("table", { name: "Score" });
  expect(within(score).getByText("4")).toBeVisible();
  expect(within(score).getByText("2")).toBeVisible();
});

test("ending the match shows the result, with the reason it ended", async () => {
  const { user } = await renderMatch();
  await startMatch(user);

  await openScoreSheet(user);

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
  const { user } = await renderMatch();
  await startMatch(user);

  await openScoreSheet(user);

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
  const { user } = await renderMatch();
  await startMatch(user);

  await user.click(screen.getByRole("button", { name: "Ace" }));
  await waitFor(() => {
    expect(vi.mocked(append)).toHaveBeenCalledTimes(2);
  });
  vi.mocked(append).mockClear();

  await openScoreSheet(user);

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
