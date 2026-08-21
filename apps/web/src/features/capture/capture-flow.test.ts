import { describe, expect, test } from "vitest";

import { commitDraft, startPoint, transition } from "./capture-flow";
import type { CaptureState, PointDraft } from "./capture-flow";
import type { CourtSide } from "./point";
import { Point } from "./point";

const MATCH_ID = "match-1";
const SERVE_TARGET = "T";
const AD_TARGET = "WIDE";
const COURT_ZONE = { half: "DEUCE", depth: "MID" } as const;

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
    unusualNote: null,
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
  test("in → RALLY, target alone is the location — courtSide lives on the draft, not the serve", () => {
    const state = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    expect(state.step).toEqual({ name: "RALLY" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "IN", location: SERVE_TARGET }]);
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

  test("ace → READY, won by the server, target alone is the location", () => {
    const state = transition(startTracked(), { type: "TAP_SERVE_ACE", target: AD_TARGET });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(true);
    expect(state.draft.endReason).toBe("ACE");
    expect(state.draft.rallyLengthBucket).toBe("B1");
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "ACE", location: AD_TARGET }]);
  });

  test("rejects an ace with no target — tracked serve placement is always captured", () => {
    expect(() => transition(startTracked(), { type: "TAP_SERVE_ACE" })).toThrow(
      /requires a target/,
    );
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

  test("rejects an ace with a target — opponent serve placement is out of scope", () => {
    expect(() =>
      transition(startOpponent(), { type: "TAP_SERVE_ACE", target: SERVE_TARGET }),
    ).toThrow(/must omit target/);
  });

  test("fault on the second serve → READY, DOUBLE_FAULT, won by the tracked player", () => {
    let state = transition(startOpponent(), { type: "TAP_SERVE_FAULT" });
    state = transition(state, { type: "TAP_SERVE_FAULT" });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.won).toBe(true); // the opponent double-faulted, we win the point
    expect(state.draft.endReason).toBe("DOUBLE_FAULT");
  });

  test("return in → RALLY, the serve is recorded as IN with no location", () => {
    const state = transition(startOpponent(), { type: "TAP_RETURN", outcome: "IN" });
    expect(state.step).toEqual({ name: "RALLY" });
    expect(state.draft.serves).toEqual([{ number: 1, outcome: "IN", location: null }]);
    expect(state.draft.returnOutcome).toBeNull();
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
      target: SERVE_TARGET,
    });
    const state = transition(afterServe, { type: "TAP_LET" });
    expect(state).toEqual(startTracked());
  });

  test("rally let preserves courtSide unchanged — the same point, replayed", () => {
    const afterServe = transition(startTracked("AD"), {
      type: "TAP_SERVE_IN",
      target: AD_TARGET,
    });
    const state = transition(afterServe, { type: "TAP_LET" });
    expect(state.draft.courtSide).toBe("AD");
  });

  test("rejects a let from a step other than serve or rally", () => {
    const onShotDetail = transition(
      transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET }),
      { type: "TAP_RALLY_OUTCOME", won: true, endReason: "FORCED" },
    );
    expect(() => transition(onShotDetail, { type: "TAP_LET" })).toThrow(/not valid on step/);
  });
});

describe("rally screen", () => {
  const start = () => transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });

  // A copy-paste bug wiring the same (won, endReason) to more than one button would
  // pass a single-case test — this guards that all four combinations stay distinct.
  test.each([
    [true, "FORCED"],
    [false, "FORCED"],
    [true, "MISTAKE"],
    [false, "MISTAKE"],
  ] as const)("won=%s endReason=%s → SHOT_DETAIL with those fields set", (won, endReason) => {
    const state = transition(start(), { type: "TAP_RALLY_OUTCOME", won, endReason });
    expect(state.step).toEqual({ name: "SHOT_DETAIL" });
    expect(state.draft.won).toBe(won);
    expect(state.draft.endReason).toBe(endReason);
  });
});

describe("full happy path — serve through commit", () => {
  test("a FORCED win threads through every screen and commits to a valid Point", () => {
    let state: CaptureState = startTracked();
    state = transition(state, { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    state = transition(state, { type: "TAP_RALLY_OUTCOME", won: true, endReason: "FORCED" });
    state = transition(state, { type: "TAP_SHOT_DETAIL", wing: "FOREHAND", shotType: "DRIVE" });
    state = transition(state, { type: "TAP_BALL_LOCATION", ballIn: true, location: COURT_ZONE });
    state = transition(state, { type: "TAP_RALLY_LENGTH", bucket: "B2" });

    expect(state.step).toEqual({ name: "READY" });

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000);
    expect(point).toBeInstanceOf(Point);
    expect(point.won).toBe(true);
    expect(point.endReason).toBe("FORCED");
    expect(point.wing).toBe("FOREHAND");
    expect(point.rallyLengthBucket).toBe("B2");
  });
});

describe("unusual point", () => {
  test("rejects Unusual on the first serve — nothing committable exists yet", () => {
    expect(() => transition(startTracked(), { type: "TAP_UNUSUAL" })).toThrow(/not valid on step/);
  });

  test("rejects Unusual on the second serve too — a lone fault still can't commit", () => {
    // Point.create requires a faulted first serve to have a second attempt. Reaching
    // UNUSUAL_OUTCOME from here would produce a draft commitDraft can never turn into
    // a Point, so this stays blocked even though a serve outcome (the fault) exists.
    const afterFault = transition(startTracked(), { type: "TAP_SERVE_FAULT", location: "NET" });
    expect(() => transition(afterFault, { type: "TAP_UNUSUAL" })).toThrow(/not valid on step/);
  });

  test("reachable from the rally screen, win/loss is mandatory, reason is optional", () => {
    const onRally = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    let state = transition(onRally, { type: "TAP_UNUSUAL" });
    expect(state.step).toEqual({ name: "UNUSUAL_OUTCOME" });

    state = transition(state, { type: "TAP_UNUSUAL_OUTCOME", won: false });
    expect(state.step).toEqual({ name: "UNUSUAL_REASON" });
    expect(state.draft.won).toBe(false);
    expect(state.draft.endReason).toBe("UNUSUAL");

    // The escape hatch stays an escape hatch — skipping the reason must not throw.
    state = transition(state, { type: "TAP_UNUSUAL_REASON", reason: null, note: null });
    expect(state.step).toEqual({ name: "RALLY_LENGTH" });
    expect(state.draft.unusualReason).toBeNull();
    expect(state.draft.unusualNote).toBeNull();
  });

  test("an unusual point's rally length is never auto-filled, unlike ACE/DOUBLE_FAULT", () => {
    const onRally = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    let state = transition(onRally, { type: "TAP_UNUSUAL" });
    state = transition(state, { type: "TAP_UNUSUAL_OUTCOME", won: true });
    state = transition(state, {
      type: "TAP_UNUSUAL_REASON",
      reason: "POINT_PENALTY",
      note: null,
    });
    // Reaching RALLY_LENGTH without having tapped it yet — bucket is still null,
    // in contrast to readyWithNoRally's "B1" default for ACE/DOUBLE_FAULT.
    expect(state.draft.rallyLengthBucket).toBeNull();

    state = transition(state, { type: "TAP_RALLY_LENGTH", bucket: null });
    expect(state.step).toEqual({ name: "READY" });
    expect(state.draft.rallyLengthBucket).toBeNull();

    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000);
    expect(point.rallyLengthBucket).toBeNull();
    expect(point.unusualReason).toBe("POINT_PENALTY");
  });
});

describe("undo", () => {
  test("undoes one step back to the exact prior draft", () => {
    const onRally = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    const onShotDetail = transition(onRally, {
      type: "TAP_RALLY_OUTCOME",
      won: true,
      endReason: "FORCED",
    });
    const undone = transition(onShotDetail, { type: "UNDO" });
    expect(undone.step).toEqual(onRally.step);
    expect(undone.draft).toEqual(onRally.draft);
  });

  test("restores the right draft even when two different paths reach the same step", () => {
    // RALLY_LENGTH is reachable via shot detail (wing/shotType/ballLocation set) and
    // via the unusual escape hatch (all three still null) — the step name alone
    // can't tell UNDO which draft to restore; only the history stack can.
    const onRally = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    let viaShotDetail = transition(onRally, {
      type: "TAP_RALLY_OUTCOME",
      won: true,
      endReason: "FORCED",
    });
    viaShotDetail = transition(viaShotDetail, {
      type: "TAP_SHOT_DETAIL",
      wing: "BACKHAND",
      shotType: "VOLLEY",
    });
    const beforeBallLocation = viaShotDetail;
    viaShotDetail = transition(viaShotDetail, {
      type: "TAP_BALL_LOCATION",
      ballIn: true,
      location: COURT_ZONE,
    });

    const undone = transition(viaShotDetail, { type: "UNDO" });
    expect(undone.draft).toEqual(beforeBallLocation.draft);
    expect(undone.draft.wing).toBe("BACKHAND");
  });

  test("undoing with no history discards the draft", () => {
    const state = transition(startTracked(), { type: "UNDO" });
    expect(state.step).toEqual({ name: "ABORTED" });
  });

  test("undoing twice from a two-step-deep history exhausts the stack, lands on ABORTED", () => {
    const onRally = transition(startTracked(), { type: "TAP_SERVE_IN", target: SERVE_TARGET });
    const onShotDetail = transition(onRally, {
      type: "TAP_RALLY_OUTCOME",
      won: true,
      endReason: "FORCED",
    });
    const backToRally = transition(onShotDetail, { type: "UNDO" });
    const backToServe = transition(backToRally, { type: "UNDO" });
    expect(backToServe.step).toEqual({ name: "SERVE", number: 1 });
    const aborted = transition(backToServe, { type: "UNDO" });
    expect(aborted.step).toEqual({ name: "ABORTED" });
  });
});

describe("commitDraft", () => {
  test("a valid READY draft for each endReason produces a Point that passes Point.create", () => {
    const cases: PointDraft[] = [
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "IN", location: SERVE_TARGET }],
        won: true,
        endReason: "FORCED",
        wing: "FOREHAND",
        shotType: "DRIVE",
        ballIn: true,
        ballLocation: COURT_ZONE,
        rallyLengthBucket: "B2",
      }),
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "IN", location: SERVE_TARGET }],
        won: false,
        endReason: "MISTAKE",
        wing: "BACKHAND",
        shotType: "VOLLEY",
        ballIn: false,
        ballLocation: "LONG",
        rallyLengthBucket: "B1",
      }),
      freshDraft("TRACKED", {
        serves: [{ number: 1, outcome: "ACE", location: AD_TARGET }],
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
        serves: [{ number: 1, outcome: "IN", location: SERVE_TARGET }],
        won: false,
        endReason: "UNUSUAL",
        unusualReason: "HINDRANCE",
        unusualNote: "adjacent court",
        rallyLengthBucket: null,
      }),
    ];

    for (const draft of cases) {
      expect(() => commitDraft(draft, "point-1", 1_700_000_000_000)).not.toThrow();
    }
  });

  test("a return error reached via transition() commits — the no-rally shortcut is a real Point", () => {
    const state = transition(startOpponent(), {
      type: "TAP_RETURN",
      outcome: "WIDE",
      endReason: "FORCED",
    });
    expect(state.step).toEqual({ name: "READY" });
    const point = commitDraft(state.draft, "point-1", 1_700_000_000_000);
    expect(point.returnOutcome).toBe("WIDE");
    expect(point.won).toBe(false);
    expect(point.endReason).toBe("FORCED");
    expect(point.rallyLengthBucket).toBe("B1");
    expect(point.wing).toBeNull();
    expect(point.ballLocation).toBeNull();
  });

  test("a broken draft (READY reached with no endReason) throws via Point.create, not silently", () => {
    const broken = freshDraft("TRACKED", {
      serves: [{ number: 1, outcome: "IN", location: SERVE_TARGET }],
      won: true,
      // endReason left null — transition() should never actually produce this, but
      // commitDraft must not paper over it if some future bug does.
    });
    expect(() => commitDraft(broken, "point-1", 1_700_000_000_000)).toThrow();
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
    expect(() =>
      transition(startOpponent(), { type: "TAP_SERVE_IN", target: SERVE_TARGET }),
    ).toThrow(/not valid on step/);
  });

  test("rejects TAP_RETURN when the tracked player is serving — no return tap on that screen", () => {
    expect(() => transition(startTracked(), { type: "TAP_RETURN", outcome: "IN" })).toThrow(
      /not valid on step/,
    );
  });
});
