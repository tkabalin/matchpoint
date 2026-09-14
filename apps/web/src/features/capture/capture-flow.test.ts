import { describe, expect, test } from "vitest";

import { commitDraft, startPoint, transition } from "./capture-flow";
import type { CaptureState, PointDraft } from "./capture-flow";
import type { CourtSide } from "./point";
import { Point } from "./point";

const MATCH_ID = "match-1";
const COURT_ZONE = { half: "DEUCE", depth: "DEEP" } as const;

// Where the point sat in the match. commitDraft only carries it onto the Point; what
// the nine stamps mean, and how they are computed, is score.test.ts's subject.
const CONTEXT = {
  setNumber: 1,
  gameNumber: 1,
  inTiebreak: false,
  isBreakPoint: false,
  isGamePoint: false,
  isGameEnd: false,
  isSetPoint: false,
  isSetEnd: false,
  isMatchPoint: false,
} as const;

/** Starts a tracked-serving point — courtSide defaults to DEUCE. */
function startTracked(courtSide: CourtSide = "DEUCE") {
  return startPoint(MATCH_ID, 0, "TRACKED", courtSide);
}

/** Starts an opponent-serving point — courtSide defaults to DEUCE. */
function startOpponent(courtSide: CourtSide = "DEUCE") {
  return startPoint(MATCH_ID, 0, "OPPONENT", courtSide);
}

/** The draft startPoint produces — override just the fields a test cares about. */
function freshDraft(
  server: "TRACKED" | "OPPONENT",
  overrides: Partial<PointDraft> = {},
): PointDraft {
  return {
    matchId: MATCH_ID,
    sequence: 0,
    server,
    courtSide: "DEUCE",
    serves: [],
    returnOutcome: null,
    won: null,
    endReason: null,
    unusualReason: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: null,
    ballLocation: null,
    rallyLengthBucket: null,
    ...overrides,
  };
}

describe("startPoint", () => {
  test("TRACKED starts on the first serve, with the given courtSide attached", () => {
    const state = startTracked();
    expect(state.step).toEqual({ name: "SERVE", number: 1 });
    expect(state.draft).toEqual(freshDraft("TRACKED"));
    expect(state.history).toEqual([]);
    expect(state.draft.courtSide).toBe("DEUCE");
  });

  test("OPPONENT starts on the first serve — courtSide is attached the same way, not tracked-only", () => {
    const state = startOpponent();
    expect(state.step).toEqual({ name: "SERVE", number: 1 });
    expect(state.draft).toEqual(freshDraft("OPPONENT"));
    expect(state.history).toEqual([]);
    expect(state.draft.courtSide).toBe("DEUCE");
  });
});

describe("serve — tracked player", () => {
  test("in → BALL_LOCATION — one tap says it landed, not where inside the box", () => {
    const state = transition(startTracked(), { type: "TAP_SERVE_IN" });
    expect(state.step).toEqual({ name: "BALL_LOCATION" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "IN", location: null }]);
  });

  test("fault on the first serve → SERVE number 2, the fault is kept not overwritten", () => {
    const state = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    expect(state.step).toEqual({ name: "SERVE", number: 2 });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "FAULT", location: "NET" }]);
  });

  test("fault on the second serve → READY, DOUBLE_FAULT, no rally to ask about", () => {
    let state = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    state = transition(state, { type: "TAP_SERVE_FAULT", location: "LONG" });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.serves).toEqual([
      { number: 1, outcome: "FAULT", location: "NET" },
      { number: 2, outcome: "FAULT", location: "LONG" },
    ]);
    expect(state.draft.won).toBe(false); // the server (tracked) lost the point
    expect(state.draft.endReason).toBe("DOUBLE_FAULT");
    expect(state.draft.rallyLengthBucket).toBe("B1");
  });

  test("ace → READY, won by the server, and carrying no placement", () => {
    const state = transition(startTracked(), { type: "TAP_SERVE_ACE" });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(true);
    expect(state.draft.endReason).toBe("ACE");
    expect(state.draft.rallyLengthBucket).toBe("B1");
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "ACE", location: null }]);
  });
});

describe("serve — opponent", () => {
  test("ace → READY, won by the opponent (our player never touched it)", () => {
    const state = transition(startOpponent(), { type: "TAP_SERVE_ACE" });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(false);
    expect(state.draft.endReason).toBe("ACE");
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "ACE", location: null }]);
  });

  test("fault on the second serve → READY, DOUBLE_FAULT, won by the tracked player", () => {
    let state = transition(startOpponent(), { type: "TAP_SERVE_FAULT" });
    state = transition(state, { type: "TAP_SERVE_FAULT" });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(true); // the opponent double-faulted, we win the point
    expect(state.draft.endReason).toBe("DOUBLE_FAULT");
  });

  test("return in → BALL_LOCATION, the serve is recorded as IN with no location", () => {
    const state = transition(startOpponent(), { type: "TAP_RETURN", outcome: "IN" });
    expect(state.step).toEqual({ name: "BALL_LOCATION" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "IN", location: null }]);
    expect(state.draft.returnOutcome).toBe("IN");
  });

  test("return error → READY, the no-rally shortcut — returnOutcome already says where it went", () => {
    const state = transition(startOpponent(), {
      type: "TAP_RETURN",
      outcome: "NET",
      endReason: "MISTAKE",
    });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.returnOutcome).toBe("NET");
    expect(state.draft.won).toBe(false);
    expect(state.draft.endReason).toBe("MISTAKE");
    expect(state.draft.rallyLengthBucket).toBe("B1"); // auto-filled, same as ACE/DOUBLE_FAULT
  });

  test("rejects a return error with no endReason — forced vs mistake must be chosen", () => {
    expect(() => transition(startOpponent(), { type: "TAP_RETURN", outcome: "WIDE" })).toThrow(
      /requires endReason/,
    );
  });

  test("rejects a return-in with an endReason — nothing to classify yet", () => {
    expect(() =>
      transition(startOpponent(), { type: "TAP_RETURN", outcome: "IN", endReason: "MISTAKE" }),
    ).toThrow(/must omit endReason/);
  });
});

describe("let", () => {
  test("service let on the first serve is a no-op — nothing was recorded yet", () => {
    const start = startTracked();
    const state = transition(start, { type: "TAP_LET" });
    expect(state).toEqual(start);
  });

  test("service let on the second serve keeps the first-serve fault, doesn't reset to first serve", () => {
    const afterFault = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    const state = transition(afterFault, { type: "TAP_LET" });
    expect(state).toEqual(afterFault);
  });

  test("rally let resets the whole point to first serve, clearing serves and history", () => {
    const afterServe = transition(startTracked(), {
      type: "TAP_SERVE_IN",
    });
    const state = transition(afterServe, { type: "TAP_LET" });
    expect(state).toEqual(startTracked());
  });

  test("rally let preserves courtSide unchanged — the same point, replayed", () => {
    const afterServe = transition(startTracked("AD"), {
      type: "TAP_SERVE_IN",
    });
    const state = transition(afterServe, { type: "TAP_LET" });
    expect(state.draft.courtSide).toBe("AD");
  });

  test("rejects a let from a step other than serve or final ball", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    const onLength = transition(onBall, {
      type: "TAP_BALL_LOCATION",
      won: true,
      ballIn: true,
      location: COURT_ZONE,
    });
    expect(() => transition(onLength, { type: "TAP_LET" })).toThrow(/not valid on step/);
  });
});

describe("note", () => {
  test("adds a note to the draft without advancing the step", () => {
    const start = startTracked();
    const state = transition(start, { type: "ADD_NOTE", text: "double bounce, let it go" });
    expect(state.step).toEqual(start.step);
    expect(state.draft.note).toBe("double bounce, let it go");
  });

  test("doesn't push onto history — an undo skips straight past it", () => {
    const start = startTracked();
    const noted = transition(start, { type: "ADD_NOTE", text: "first note" });
    expect(noted.history).toEqual(start.history);
  });

  test("a second note appends onto a new line rather than overwriting the first", () => {
    const once = transition(startTracked(), { type: "ADD_NOTE", text: "first note" });
    const twice = transition(once, { type: "ADD_NOTE", text: "second note" });
    expect(twice.draft.note).toBe("first note\nsecond note");
  });

  test("blank or whitespace-only text is a no-op — no empty note recorded", () => {
    const state = transition(startTracked(), { type: "ADD_NOTE", text: "   " });
    expect(state.draft.note).toBeNull();
  });

  test("trims surrounding whitespace off a real note", () => {
    const state = transition(startTracked(), { type: "ADD_NOTE", text: "  spacing  " });
    expect(state.draft.note).toBe("spacing");
  });

  test("survives an ordinary step transition", () => {
    const noted = transition(startTracked(), { type: "ADD_NOTE", text: "watch the toss" });
    const state = transition(noted, { type: "TAP_SERVE_IN" });
    expect(state.draft.note).toBe("watch the toss");
  });

  test("a rally let discards the note along with the rest of the draft", () => {
    const afterServe = transition(startTracked(), {
      type: "TAP_SERVE_IN",
    });
    const noted = transition(afterServe, { type: "ADD_NOTE", text: "mid-rally note" });
    const state = transition(noted, { type: "TAP_LET" });
    expect(state.draft.note).toBeNull();
  });
});

describe("final ball", () => {
  const start = () => transition(startTracked(), { type: "TAP_SERVE_IN" });

  // The half the ball finished in is also who won: the screen resolves that and this
  // module stores it, so both directions are checked, not just one.
  test.each([true, false])("won=%s is stored with the zone, then the length is asked", (won) => {
    const state = transition(start(), {
      type: "TAP_BALL_LOCATION",
      won,
      ballIn: true,
      location: COURT_ZONE,
    });
    expect(state.step).toEqual({ name: "RALLY_LENGTH" });
    expect(state.draft.won).toBe(won);
    expect(state.draft.ballIn).toBe(true);
    expect(state.draft.ballLocation).toEqual(COURT_ZONE);
    expect(state.draft.endReason).toBeNull(); // forced or unforced is still to come
  });

  test("a rally let clears the location and winner along with the rest of the draft", () => {
    const onBall = start();
    const replayed = transition(onBall, { type: "TAP_LET" });
    expect(replayed).toEqual(startTracked());
  });
});

describe("rally length and ending", () => {
  const onLength = () =>
    transition(transition(startTracked(), { type: "TAP_SERVE_IN" }), {
      type: "TAP_BALL_LOCATION",
      won: true,
      ballIn: true,
      location: COURT_ZONE,
    });

  test("the length is asked before the ending", () => {
    const state = transition(onLength(), { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    expect(state.step).toEqual({ name: "ENDING" });
    expect(state.draft.rallyLengthBucket).toBe("B2");
  });

  test("a forced ending goes on to the shot", () => {
    let state = transition(onLength(), { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    state = transition(state, { type: "TAP_ENDING", endReason: "FORCED" });
    expect(state.step).toEqual({ name: "SHOT_DETAIL" });
    expect(state.draft.endReason).toBe("FORCED");
  });

  test("an unforced error skips the shot and commits with none recorded, which Point.create allows", () => {
    let state = transition(onLength(), { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    state = transition(state, { type: "TAP_ENDING", endReason: "MISTAKE" });
    expect(state.step).toEqual({ name: "READY" });

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.wing).toBeNull();
    expect(point.shotType).toBeNull();
    expect(point.ballLocation).toEqual(COURT_ZONE);
  });
});

describe("full happy path — serve through commit", () => {
  test("a FORCED win threads through every screen and commits to a valid Point", () => {
    let state: CaptureState = startTracked();
    state = transition(state, { type: "TAP_SERVE_IN" });
    state = transition(state, {
      type: "TAP_BALL_LOCATION",
      won: true,
      ballIn: true,
      location: COURT_ZONE,
    });
    state = transition(state, { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    state = transition(state, { type: "TAP_ENDING", endReason: "FORCED" });
    state = transition(state, { type: "TAP_SHOT_DETAIL", wing: "FOREHAND", shotType: "DRIVE" });

    expect(state.step).toEqual({ name: "READY" });

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point).toBeInstanceOf(Point);
    expect(point.won).toBe(true);
    expect(point.endReason).toBe("FORCED");
    expect(point.wing).toBe("FOREHAND");
    expect(point.rallyLengthBucket).toBe("B2");
  });
});

describe("unusual point", () => {
  test("from the first serve, no serve is recorded rather than one assumed", () => {
    const state = transition(startTracked(), { type: "TAP_UNUSUAL" });
    expect(state.step).toEqual({ name: "UNUSUAL_OUTCOME" });
    expect(state.draft.serves).toEqual([]);
  });

  test("from the second serve, the fault already recorded survives", () => {
    const afterFault = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    const state = transition(afterFault, { type: "TAP_UNUSUAL" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "FAULT", location: "NET" }]);
  });

  test("a point skipped from the serve commits with its winner and nothing else", () => {
    let state = transition(startTracked(), { type: "TAP_UNUSUAL" });
    state = transition(state, { type: "TAP_UNUSUAL_OUTCOME", won: false });
    state = transition(state, { type: "TAP_UNUSUAL_REASON", reason: null });
    expect(state.step).toEqual({ name: "READY" });

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.won).toBe(false);
    expect(point.firstServeIn).toBeNull();
    expect(point.rallyLengthBucket).toBeNull();
  });

  test("reachable from the final ball, win/loss is mandatory, reason is optional", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    let state = transition(onBall, { type: "TAP_UNUSUAL" });
    expect(state.step).toEqual({ name: "UNUSUAL_OUTCOME" });

    state = transition(state, { type: "TAP_UNUSUAL_OUTCOME", won: false });
    expect(state.step).toEqual({ name: "UNUSUAL_REASON" });
    expect(state.draft.won).toBe(false);
    expect(state.draft.endReason).toBe("UNUSUAL");

    // The escape hatch stays an escape hatch — skipping the reason must not throw.
    state = transition(state, { type: "TAP_UNUSUAL_REASON", reason: null });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.unusualReason).toBeNull();
  });

  test("an unusual point's rally length is never auto-filled, unlike ACE/DOUBLE_FAULT", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    let state = transition(onBall, { type: "TAP_UNUSUAL" });
    state = transition(state, { type: "TAP_UNUSUAL_OUTCOME", won: true });
    state = transition(state, { type: "TAP_UNUSUAL_REASON", reason: "POINT_PENALTY" });
    // Ready without the length ever being asked — bucket is still null, in contrast
    // to readyDraft's "B1" default for ACE/DOUBLE_FAULT.
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.rallyLengthBucket).toBeNull();

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.rallyLengthBucket).toBeNull();
    expect(point.unusualReason).toBe("POINT_PENALTY");
  });
});

describe("undo", () => {
  const onLength = () =>
    transition(transition(startTracked(), { type: "TAP_SERVE_IN" }), {
      type: "TAP_BALL_LOCATION",
      won: true,
      ballIn: true,
      location: COURT_ZONE,
    });

  test("undoes one step back to the exact prior draft", () => {
    const before = onLength();
    const onEnding = transition(before, { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    const undone = transition(onEnding, { type: "UNDO" });
    expect(undone.step).toEqual(before.step);
    expect(undone.draft).toEqual(before.draft);
  });

  test("restores the right draft even when two different paths reach the same step", () => {
    // READY is reachable via the shot (wing/shotType set) and via an unforced error
    // (both still null) — the step name alone can't tell UNDO which draft to restore;
    // only the history stack can.
    let viaShot = transition(onLength(), { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    viaShot = transition(viaShot, { type: "TAP_ENDING", endReason: "FORCED" });
    const beforeShot = viaShot;
    viaShot = transition(viaShot, {
      type: "TAP_SHOT_DETAIL",
      wing: "BACKHAND",
      shotType: "VOLLEY",
    });

    const undone = transition(viaShot, { type: "UNDO" });
    expect(undone.draft).toEqual(beforeShot.draft);
    expect(undone.draft.wing).toBeNull();
  });

  test("undoing with no history discards the draft", () => {
    const state = transition(startTracked(), { type: "UNDO" });
    expect(state.step).toEqual({ name: "ABORTED" });
  });

  test("undoing twice from a two-step-deep history exhausts the stack, lands on ABORTED", () => {
    const backToBall = transition(onLength(), { type: "UNDO" });
    const backToServe = transition(backToBall, { type: "UNDO" });
    expect(backToServe.step).toEqual({ name: "SERVE", number: 1 });
    const aborted = transition(backToServe, { type: "UNDO" });
    expect(aborted.step).toEqual({ name: "ABORTED" });
  });
});

describe("commitDraft", () => {
  test("a valid READY draft for each endReason produces a Point that passes Point.create", () => {
    const cases: PointDraft[] = [
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "IN", location: null }],
        won: true,
        endReason: "FORCED",
        wing: "FOREHAND",
        shotType: "DRIVE",
        ballIn: true,
        ballLocation: COURT_ZONE,
        rallyLengthBucket: "B2",
      }),
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "IN", location: null }],
        won: false,
        endReason: "MISTAKE",
        wing: "BACKHAND",
        shotType: "VOLLEY",
        ballIn: false,
        ballLocation: "LONG",
        rallyLengthBucket: "B1",
      }),
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "ACE", location: null }],
        won: true,
        endReason: "ACE",
        rallyLengthBucket: "B1",
      }),
      freshDraft("TRACKED", {
        serves: [
          { number: 1, outcome: "FAULT", location: "NET" },
          { number: 2, outcome: "FAULT", location: "LONG" },
        ],
        won: false,
        endReason: "DOUBLE_FAULT",
        rallyLengthBucket: "B1",
      }),
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "IN", location: null }],
        won: false,
        endReason: "UNUSUAL",
        unusualReason: "HINDRANCE",
        rallyLengthBucket: null,
      }),
    ];

    for (const draft of cases) {
      expect(() => commitDraft(draft, "point-1", 1_700_000_000_000, CONTEXT)).not.toThrow();
    }
  });

  test("a return error reached via transition() commits — the no-rally shortcut is a real Point", () => {
    const state = transition(startOpponent(), {
      type: "TAP_RETURN",
      outcome: "WIDE",
      endReason: "FORCED",
    });
    expect(state.step).toEqual({ name: "READY" });
    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.returnOutcome).toBe("WIDE");
    expect(point.won).toBe(false);
    expect(point.endReason).toBe("FORCED");
    expect(point.rallyLengthBucket).toBe("B1");
    expect(point.wing).toBeNull();
    expect(point.ballLocation).toBeNull();
  });

  test("an ending nobody saw commits — endReason null is an observation hole, not a break", () => {
    const unseen = freshDraft("TRACKED", {
      serves: [{ number: 1, outcome: "IN", location: null }],
      won: true,
    });
    const point = commitDraft(unseen, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.endReason).toBeNull();
    expect(point.won).toBe(true);
  });

  test("a broken draft (READY reached with no winner) throws via Point.create, not silently", () => {
    const broken = freshDraft("TRACKED", {
      serves: [{ number: 1, outcome: "IN", location: null }],
      // won left null — transition() should never actually produce this, but commitDraft
      // must not paper over it if some future bug does: a Point is its winner.
    });
    expect(() => commitDraft(broken, "point-1", 1_700_000_000_000, CONTEXT)).toThrow();
  });
});

describe("didn't see", () => {
  test("from the serve, no serve is recorded and the rally is still ahead", () => {
    const state = transition(startTracked(), { type: "TAP_DIDNT_SEE" });
    expect(state.step).toEqual({ name: "BALL_LOCATION" });
    expect(state.draft.serves).toEqual([]);
  });

  test("from the second serve, the fault already watched survives", () => {
    const afterFault = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    const state = transition(afterFault, { type: "TAP_DIDNT_SEE" });
    expect(state.step).toEqual({ name: "BALL_LOCATION" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "FAULT", location: "NET" }]);
  });

  test("from the final ball it still needs the winner, and leaves the ending unknown", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    const state = transition(onBall, { type: "TAP_DIDNT_SEE", won: false });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(false);
    expect(state.draft.endReason).toBeNull();
    expect(state.draft.ballLocation).toBeNull();
    expect(state.draft.rallyLengthBucket).toBeNull();
  });

  test("from the final ball without a winner it throws rather than guessing", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    expect(() => transition(onBall, { type: "TAP_DIDNT_SEE" })).toThrow(/requires won/);
  });

  test("from the shot screen, the stroke is left null and the point commits", () => {
    let state = transition(startTracked(), { type: "TAP_SERVE_IN" });
    state = transition(state, {
      type: "TAP_BALL_LOCATION",
      won: true,
      ballIn: true,
      location: COURT_ZONE,
    });
    state = transition(state, { type: "TAP_RALLY_LENGTH", bucket: "B2" });
    state = transition(state, { type: "TAP_ENDING", endReason: "FORCED" });
    state = transition(state, { type: "TAP_DIDNT_SEE" });
    expect(state.step).toEqual({ name: "READY" });

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.wing).toBeNull();
    expect(point.shotType).toBeNull();
    expect(point.endReason).toBe("FORCED");
  });

  test("undo steps back into the screen that was skipped", () => {
    const onBall = transition(startTracked(), { type: "TAP_SERVE_IN" });
    const skipped = transition(onBall, { type: "TAP_DIDNT_SEE", won: true });
    expect(transition(skipped, { type: "UNDO" }).step).toEqual({ name: "BALL_LOCATION" });
  });

  test("a point with every observation missing still commits with its winner", () => {
    let state = transition(startTracked(), { type: "TAP_DIDNT_SEE" });
    state = transition(state, { type: "TAP_DIDNT_SEE", won: true });
    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000, CONTEXT);
    expect(point.won).toBe(true);
    expect(point.serves).toEqual([]);
    expect(point.endReason).toBeNull();
    expect(point.firstServeIn).toBeNull();
  });
});

describe("action validity guards", () => {
  test("rejects an action that doesn't belong on the current step", () => {
    expect(() =>
      transition(startTracked(), {
        type: "TAP_SHOT_DETAIL",
        wing: "FOREHAND",
        shotType: "DRIVE",
      }),
    ).toThrow(/not valid on step/);
  });

  test("rejects TAP_SERVE_IN when the opponent is serving — no such tap on that screen", () => {
    expect(() => transition(startOpponent(), { type: "TAP_SERVE_IN" })).toThrow(
      /not valid on step/,
    );
  });

  test("rejects TAP_RETURN when the tracked player is serving — no return tap on that screen", () => {
    expect(() => transition(startTracked(), { type: "TAP_RETURN", outcome: "IN" })).toThrow(
      /not valid on step/,
    );
  });
});
