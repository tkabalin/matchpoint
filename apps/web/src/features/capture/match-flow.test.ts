import { describe, expect, test } from "vitest";

import { ScoreCheckpoint } from "./checkpoint";
import { isMatchOver, retireMatch, startNextPoint, undoLast } from "./match-flow";
import { createMatch } from "./match";
import type { MatchOutcomeOverride, ScoringSystem } from "./match";
import { Point } from "./point";
import { applyPoint, initialBoard } from "./score";
import type { MatchEvent } from "./score";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

/** A minimal Match via createMatch — override just what a test cares about. */
function matchOf(
  scoringSystem: ScoringSystem = "traditional",
  firstServer: string = TRACKED_ID,
  outcomeOverride: MatchOutcomeOverride | null = null,
) {
  return createMatch(
    "2024-01-01",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    firstServer,
    scoringSystem,
    "unspecified",
    outcomeOverride,
  );
}

function boardAfter(match: ReturnType<typeof matchOf>, wins: boolean[]) {
  return wins.reduce((board, won) => applyPoint(match, board, won), initialBoard(match));
}

function pointAt(matchId: string, sequence: number) {
  return Point.create({
    id: `point-${String(sequence)}`,
    matchId,
    timestamp: 1_700_000_000_000 + sequence,
    sequence,
    server: "TRACKED",
    courtSide: "DEUCE",
    won: true,
    context: {
      setNumber: 1,
      gameNumber: 1,
      inTiebreak: false,
      isBreakPoint: false,
      isGamePoint: false,
      isGameEnd: false,
      isSetPoint: false,
      isSetEnd: false,
      isMatchPoint: false,
    },
    serves: [],
    returnOutcome: null,
    endReason: null,
    unusualReason: null,
    unusualNote: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: null,
    ballLocation: null,
    rallyLengthBucket: null,
  });
}

describe("startNextPoint", () => {
  test("brand-new match: sequence, server and court side all come off the board", () => {
    const match = matchOf();
    const state = startNextPoint(match, initialBoard(match), 0);
    expect(state.step).toEqual({ name: "SERVE", number: 1 });
    expect(state.draft.matchId).toBe(match.matchId);
    expect(state.draft.sequence).toBe(0);
    expect(state.draft.server).toBe("TRACKED");
    expect(state.draft.courtSide).toBe("DEUCE");
  });

  test("mid-match: the server follows the rotation and the side follows the game", () => {
    const match = matchOf();
    // One clean game, then one point into the next: serve has flipped, side is ad.
    const board = boardAfter(match, [true, true, true, true, true]);
    const state = startNextPoint(match, board, 5);
    expect(state.draft.sequence).toBe(5);
    expect(state.draft.server).toBe("OPPONENT");
    expect(state.draft.courtSide).toBe("AD");
  });

  test("the sequence is the caller's to supply, not derived from the log", () => {
    const match = matchOf();
    // An undone point leaves a gap that must never be handed out again.
    expect(startNextPoint(match, initialBoard(match), 9).draft.sequence).toBe(9);
  });
});

describe("undoLast", () => {
  test("drops the newest event and hands it back", () => {
    const match = matchOf();
    const events: MatchEvent[] = [pointAt(match.matchId, 0), pointAt(match.matchId, 1)];
    const { events: remaining, removed } = undoLast(events);
    expect(remaining).toHaveLength(1);
    expect(removed?.id).toBe("point-1");
  });

  test("drops a checkpoint just the same — the tail is the tail", () => {
    const match = matchOf();
    const checkpoint = ScoreCheckpoint.create({
      id: "checkpoint-1",
      matchId: match.matchId,
      timestamp: 1,
      sequence: 1,
      after: { sets: [{ tracked: 4, opponent: 2, tiebreak: null }], game: null },
      servesNext: "TRACKED",
      orderChanged: false,
    });
    const { events, removed } = undoLast([pointAt(match.matchId, 0), checkpoint]);
    expect(events).toHaveLength(1);
    expect(removed).toBe(checkpoint);
  });

  test("an empty log has nothing to undo, and says so rather than throwing", () => {
    expect(undoLast([])).toEqual({ events: [], removed: null });
  });

  test("never mutates the log it was given", () => {
    const match = matchOf();
    const events: MatchEvent[] = [pointAt(match.matchId, 0)];
    undoLast(events);
    expect(events).toHaveLength(1);
  });
});

describe("retireMatch", () => {
  test("awards the match to the player who didn't retire", () => {
    const match = matchOf();
    const retired = retireMatch(match, TRACKED_ID);
    expect(retired.outcomeOverride).toEqual({ reason: "retirement", winner: OPPONENT_ID });
  });

  test("rejects a player who isn't in the match", () => {
    expect(() => retireMatch(matchOf(), "someone-else")).toThrow(/retiredPlayerId/);
  });
});

describe("isMatchOver", () => {
  test("an override ends it whatever the board says", () => {
    const match = matchOf("traditional", TRACKED_ID, {
      reason: "retirement",
      winner: OPPONENT_ID,
    });
    expect(isMatchOver(match, initialBoard(match))).toBe(true);
  });

  test("true once the sets decide it", () => {
    const match = matchOf("pro_set");
    const board = boardAfter(match, Array<boolean>(32).fill(true));
    expect(isMatchOver(match, board)).toBe(true);
  });

  test("false mid-match", () => {
    const match = matchOf();
    expect(isMatchOver(match, boardAfter(match, [true, true, true, true]))).toBe(false);
  });
});
