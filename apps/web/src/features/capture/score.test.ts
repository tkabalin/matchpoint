import { describe, expect, test } from "vitest";

import { ScoreCheckpoint } from "./checkpoint";
import type { ScoreSnapshot } from "./checkpoint";
import { createMatch } from "./match";
import type { ScoringSystem } from "./match";
import { Point } from "./point";
import type { PointContext, Server } from "./point";
import {
  applyCheckpoint,
  applyPoint,
  contextFor,
  coverageOf,
  firstServerImpliedBy,
  foldScore,
  initialBoard,
  interpretSnapshot,
  nextCourtSideFor,
  nextServerFor,
  observedOf,
  scoreboardFor,
  snapshotOf,
  validateCheckpoint,
} from "./score";
import type { Scoreboard } from "./score";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

function matchOf(scoringSystem: ScoringSystem = "traditional", trackedServesFirst = true) {
  return createMatch(
    "2024-01-01",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    trackedServesFirst ? TRACKED_ID : OPPONENT_ID,
    scoringSystem,
    "unspecified",
    null,
  );
}

/** Plays the given run of outcomes onto a board, tracked-player-wins-first. */
function play(scoringSystem: ScoringSystem, wins: boolean[], trackedServesFirst = true) {
  const match = matchOf(scoringSystem, trackedServesFirst);
  const board = wins.reduce((current, won) => applyPoint(match, current, won), initialBoard(match));
  return { match, board };
}

/** `count` clean 4-0 games, all won by the same side. */
function cleanGames(won: boolean, count: number): boolean[] {
  return Array.from({ length: count * 4 }, () => won);
}

/** Games alternating tracked, opponent, tracked, ... so neither side runs away. */
function alternating(count: number): boolean[] {
  return Array.from({ length: count }, (_, index) => cleanGames(index % 2 === 0, 1)).flat();
}

function snapshot(sets: [number, number][], game: [number, number] | null = null): ScoreSnapshot {
  return {
    sets: sets.map(([tracked, opponent]) => ({ tracked, opponent, tiebreak: null })),
    game: game === null ? null : { tracked: game[0], opponent: game[1] },
  };
}

function checkpointOf(
  matchId: string,
  after: ScoreSnapshot,
  servesNext: Server = "TRACKED",
  orderChanged = false,
) {
  return ScoreCheckpoint.create({
    id: "checkpoint-1",
    matchId,
    timestamp: 1_700_000_000_000,
    sequence: 0,
    after,
    servesNext,
    orderChanged,
  });
}

function boardOf(match: ReturnType<typeof matchOf>, after: ScoreSnapshot): Scoreboard {
  const read = interpretSnapshot(match, after);
  if ("problems" in read) throw new Error(read.problems[0]?.message ?? "unreadable snapshot");
  return read.board;
}

describe("folding points into a game", () => {
  test("a new match is love-all in set 1, nothing observed yet", () => {
    const { board } = play("traditional", []);
    expect(board.game).toEqual({ tracked: 0, opponent: 0 });
    expect(board.currentSet?.setNumber).toBe(1);
    expect(board.completedSets).toEqual([]);
    expect(board.matchWinner).toBeNull();
  });

  test("four straight points win a game, and the game resets to love-all", () => {
    const { board } = play("traditional", cleanGames(true, 1));
    expect(board.currentSet?.trackedGames).toBe(1);
    expect(board.game).toEqual({ tracked: 0, opponent: 0 });
  });

  test("ad scoring needs two clear points from deuce", () => {
    const deuce = [true, true, true, false, false, false];
    const { board: atDeuce } = play("traditional", deuce);
    expect(atDeuce.game).toEqual({ tracked: 3, opponent: 3 });

    const { board: atAd } = play("traditional", [...deuce, true]);
    expect(atAd.game).toEqual({ tracked: 4, opponent: 3 });
    expect(atAd.currentSet?.trackedGames).toBe(0);

    const { board: won } = play("traditional", [...deuce, true, true]);
    expect(won.currentSet?.trackedGames).toBe(1);
  });

  test("no-ad scoring ends the game on the first point past 40-40", () => {
    const deuce = [true, true, true, false, false, false];
    const { board } = play("no_ad_scoring", [...deuce, true]);
    expect(board.currentSet?.trackedGames).toBe(1);
  });
});

describe("folding games into a set", () => {
  test("six games to love takes the set and opens the next one", () => {
    const { board } = play("traditional", cleanGames(true, 6));
    expect(board.completedSets).toHaveLength(1);
    expect(board.completedSets[0]?.set.trackedPlayerGames).toBe(6);
    expect(board.completedSets[0]?.set.winner).toBe(TRACKED_ID);
    expect(board.currentSet?.setNumber).toBe(2);
  });

  test("5-5 is not a set — two clear games are needed", () => {
    const { board } = play("traditional", [...alternating(10)]);
    expect(board.completedSets).toEqual([]);
    expect(board.currentSet?.trackedGames).toBe(5);
    expect(board.currentSet?.opponentGames).toBe(5);
  });

  test("games-all starts the breaker, and the breaker's points are not games", () => {
    const { match, board } = play("traditional", alternating(12));
    expect(board.currentSet?.inBreaker).toBe(true);
    expect(board.game).toBeNull();

    const midBreaker = [true, true, false].reduce(
      (current, won) => applyPoint(match, current, won),
      board,
    );
    expect(midBreaker.currentSet?.tiebreak).toEqual({ tracked: 2, opponent: 1 });
    expect(midBreaker.currentSet?.trackedGames).toBe(6);
  });

  test("a breaker won 7-0 records the set as 7-6", () => {
    const { board } = play("traditional", [...alternating(12), ...Array<boolean>(7).fill(true)]);
    expect(board.completedSets[0]?.set.trackedPlayerGames).toBe(7);
    expect(board.completedSets[0]?.set.opponentGames).toBe(6);
    expect(board.completedSets[0]?.set.tiebreak).toEqual({
      trackedPlayerPoints: 7,
      opponentPoints: 0,
      target: 7,
    });
  });

  test("a breaker needs two clear points, same as a game", () => {
    const sixAll = alternating(12);
    const to66 = Array.from({ length: 12 }, (_, index) => index % 2 === 0);
    const { board } = play("traditional", [...sixAll, ...to66]);
    expect(board.completedSets).toEqual([]);
    expect(board.currentSet?.tiebreak).toEqual({ tracked: 6, opponent: 6 });
  });

  test("short sets run to four games with a breaker at 3-3, first to five", () => {
    const { board: won } = play("short_sets", cleanGames(true, 4));
    expect(won.completedSets[0]?.set.trackedPlayerGames).toBe(4);

    const { board: breaker } = play("short_sets", alternating(6));
    expect(breaker.currentSet?.inBreaker).toBe(true);

    const { board: decided } = play("short_sets", [
      ...alternating(6),
      ...Array<boolean>(5).fill(true),
    ]);
    expect(decided.completedSets[0]?.set.trackedPlayerGames).toBe(4);
    expect(decided.completedSets[0]?.set.tiebreak?.target).toBe(5);
  });

  test("legacy's decider has no breaker and plays on past 6-6", () => {
    const { match, board } = play("legacy", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 6),
      ...alternating(12),
    ]);
    expect(board.completedSets).toHaveLength(2);
    expect(board.currentSet?.setNumber).toBe(3);
    expect(board.currentSet?.inBreaker).toBe(false);
    expect(nextServerFor(board)).toBeDefined();

    const on = [...cleanGames(true, 2)].reduce(
      (current, won) => applyPoint(match, current, won),
      board,
    );
    expect(on.completedSets[2]?.set.trackedPlayerGames).toBe(8);
    expect(on.completedSets[2]?.set.opponentGames).toBe(6);
  });

  test("the match-tiebreak decider is a breaker from its first point and credits no game", () => {
    const { board } = play("match_tiebreak_10_points", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 6),
    ]);
    expect(board.currentSet?.setNumber).toBe(3);
    expect(board.currentSet?.inBreaker).toBe(true);
    expect(board.game).toBeNull();

    const { board: decided } = play("match_tiebreak_10_points", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 6),
      ...Array<boolean>(10).fill(true),
    ]);
    expect(decided.completedSets[2]?.set.trackedPlayerGames).toBe(0);
    expect(decided.completedSets[2]?.set.tiebreak).toEqual({
      trackedPlayerPoints: 10,
      opponentPoints: 0,
      target: 10,
    });
    expect(decided.matchWinner).toBe("TRACKED");
  });
});

describe("folding sets into a match", () => {
  test("two sets decide a best-of-three, and the board stops there", () => {
    const { board } = play("traditional", [...cleanGames(true, 6), ...cleanGames(true, 6)]);
    expect(board.matchWinner).toBe("TRACKED");
    expect(board.currentSet).toBeNull();
    expect(board.game).toBeNull();
  });

  test("a pro set is one set, so winning it wins the match", () => {
    const { board } = play("pro_set", cleanGames(true, 8));
    expect(board.matchWinner).toBe("TRACKED");
    expect(board.completedSets[0]?.set.trackedPlayerGames).toBe(8);
  });

  test("three sets do not decide a best-of-five", () => {
    const { board } = play("mens_grand_slam", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 6),
      ...cleanGames(true, 6),
    ]);
    expect(board.matchWinner).toBeNull();
    expect(board.currentSet?.setNumber).toBe(4);
  });

  test("a point past a decided match leaves the board alone", () => {
    const { match, board } = play("pro_set", cleanGames(true, 8));
    expect(applyPoint(match, board, false)).toBe(board);
  });
});

describe("rotation and court side", () => {
  test("serve alternates every game from whoever served first", () => {
    const { match, board } = play("traditional", []);
    expect(nextServerFor(board)).toBe("TRACKED");

    const afterOne = cleanGames(true, 1).reduce(
      (current, won) => applyPoint(match, current, won),
      board,
    );
    expect(nextServerFor(afterOne)).toBe("OPPONENT");

    const afterTwo = cleanGames(true, 1).reduce(
      (current, won) => applyPoint(match, current, won),
      afterOne,
    );
    expect(nextServerFor(afterTwo)).toBe("TRACKED");
  });

  test("the opponent serving first flips every answer", () => {
    const { board } = play("traditional", [], false);
    expect(nextServerFor(board)).toBe("OPPONENT");
  });

  test("rotation carries across a set boundary rather than restarting", () => {
    // Six games consume slots 0-5, so set 2 opens on slot 6 — back to whoever served
    // first, exactly as it would be mid-set.
    const { board } = play("traditional", cleanGames(true, 6));
    expect(board.currentSet?.setNumber).toBe(2);
    expect(nextServerFor(board)).toBe("TRACKED");

    const { board: oddSet } = play("traditional", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 1),
    ]);
    expect(nextServerFor(oddSet)).toBe("OPPONENT");
  });

  test("a breaker takes one slot, and serve inside it alternates every two points", () => {
    const { match, board } = play("traditional", alternating(12));
    // 12 games played, so the breaker's first point belongs to whoever has slot 12.
    const first = nextServerFor(board);
    const after1 = applyPoint(match, board, true);
    expect(nextServerFor(after1)).toBe(first === "TRACKED" ? "OPPONENT" : "TRACKED");
    const after2 = applyPoint(match, after1, true);
    expect(nextServerFor(after2)).toBe(first === "TRACKED" ? "OPPONENT" : "TRACKED");
    const after3 = applyPoint(match, after2, true);
    expect(nextServerFor(after3)).toBe(first);
  });

  test("court side alternates by points played, in a game and in a breaker alike", () => {
    const { match, board } = play("traditional", []);
    expect(nextCourtSideFor(board)).toBe("DEUCE");
    expect(nextCourtSideFor(applyPoint(match, board, true))).toBe("AD");

    const { match: breakerMatch, board: breaker } = play("traditional", alternating(12));
    expect(nextCourtSideFor(breaker)).toBe("DEUCE");
    expect(nextCourtSideFor(applyPoint(breakerMatch, breaker, true))).toBe("AD");
  });

  test("a fresh game is always the deuce side", () => {
    const { board } = play("traditional", cleanGames(true, 1));
    expect(nextCourtSideFor(board)).toBe("DEUCE");
  });
});

describe("interpretSnapshot", () => {
  const match = matchOf();

  test("reads completed sets, the live set and the game", () => {
    const read = interpretSnapshot(
      match,
      snapshot(
        [
          [6, 3],
          [2, 1],
        ],
        [2, 1],
      ),
    );
    expect("board" in read).toBe(true);
    if (!("board" in read)) return;
    expect(read.board.completedSets).toHaveLength(1);
    expect(read.board.currentSet?.setNumber).toBe(2);
    expect(read.board.game).toEqual({ tracked: 2, opponent: 1 });
    expect(read.board.rotation.slot).toBe(9 + 3);
  });

  test.each([
    [6, 0],
    [6, 4],
    [7, 5],
    [7, 6],
  ])("accepts a completed traditional set of %i-%i", (tracked, opponent) => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [tracked, opponent],
        [0, 0],
      ]),
    );
    expect("board" in read).toBe(true);
  });

  test.each([
    [7, 4],
    [8, 6],
    [6, 6],
  ])("refuses %i-%i as a completed set", (tracked, opponent) => {
    // Either unreachable, or (6-6) a set still in progress and so not a valid first set.
    const read = interpretSnapshot(
      match,
      snapshot([
        [tracked, opponent],
        [0, 0],
      ]),
    );
    expect("problems" in read).toBe(true);
  });

  test("names the set that is wrong", () => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [6, 0],
        [7, 4],
      ]),
    );
    expect("problems" in read).toBe(true);
    if (!("problems" in read)) return;
    expect(read.problems[0]?.cell).toBe("set:2");
  });

  test("a completed last set that doesn't decide the match opens the next one", () => {
    const read = interpretSnapshot(match, snapshot([[6, 3]]));
    expect("board" in read).toBe(true);
    if (!("board" in read)) return;
    expect(read.board.completedSets).toHaveLength(1);
    expect(read.board.currentSet?.setNumber).toBe(2);
    expect(read.board.currentSet?.trackedGames).toBe(0);
  });

  test("a decided match has no current set and no game", () => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [6, 3],
        [6, 4],
      ]),
    );
    expect("board" in read).toBe(true);
    if (!("board" in read)) return;
    expect(read.board.matchWinner).toBe("TRACKED");
    expect(read.board.currentSet).toBeNull();
    expect(read.board.game).toBeNull();
  });

  test("refuses a set played after the match was already won", () => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [6, 3],
        [6, 4],
        [1, 0],
      ]),
    );
    expect("problems" in read).toBe(true);
  });

  test("refuses a set still in progress ahead of a later one", () => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [2, 1],
        [0, 0],
      ]),
    );
    expect("problems" in read).toBe(true);
    if (!("problems" in read)) return;
    expect(read.problems[0]?.message).toMatch(/last set/);
  });

  test("refuses a game score that can't happen, and one past its format", () => {
    expect("problems" in interpretSnapshot(match, snapshot([[0, 0]], [4, 0]))).toBe(true);
    expect(
      "problems" in interpretSnapshot(matchOf("no_ad_scoring"), snapshot([[0, 0]], [4, 3])),
    ).toBe(true);
    expect("board" in interpretSnapshot(match, snapshot([[0, 0]], [4, 3]))).toBe(true);
  });

  test("refuses a game alongside a breaker, and one after the match is over", () => {
    expect("problems" in interpretSnapshot(match, snapshot([[6, 6]], [1, 0]))).toBe(true);
    expect(
      "problems" in
        interpretSnapshot(
          match,
          snapshot(
            [
              [6, 0],
              [6, 0],
            ],
            [1, 0],
          ),
        ),
    ).toBe(true);
  });

  test("a set at games-all carries its breaker score instead", () => {
    const read = interpretSnapshot(match, {
      sets: [{ tracked: 6, opponent: 6, tiebreak: { tracked: 3, opponent: 2 } }],
      game: null,
    });
    expect("board" in read).toBe(true);
    if (!("board" in read)) return;
    expect(read.board.currentSet?.inBreaker).toBe(true);
    expect(read.board.currentSet?.tiebreak).toEqual({ tracked: 3, opponent: 2 });
  });

  test("refuses a tiebreak score on a set that never had one, and a decided one still running", () => {
    const onNonBreaker = interpretSnapshot(match, {
      sets: [{ tracked: 4, opponent: 2, tiebreak: { tracked: 1, opponent: 0 } }],
      game: null,
    });
    expect("problems" in onNonBreaker).toBe(true);

    const alreadyOver = interpretSnapshot(match, {
      sets: [{ tracked: 6, opponent: 6, tiebreak: { tracked: 7, opponent: 2 } }],
      game: null,
    });
    expect("problems" in alreadyOver).toBe(true);
  });

  test("refuses a tiebreak score that disagrees with who won the set", () => {
    const read = interpretSnapshot(match, {
      sets: [
        { tracked: 7, opponent: 6, tiebreak: { tracked: 2, opponent: 7 } },
        { tracked: 0, opponent: 0, tiebreak: null },
      ],
      game: null,
    });
    expect("problems" in read).toBe(true);
    if (!("problems" in read)) return;
    expect(read.problems[0]?.cell).toBe("set:1:tiebreak");
  });

  test("the match-tiebreak decider plays no games", () => {
    const decider = matchOf("match_tiebreak_10_points");
    const withGames = interpretSnapshot(
      decider,
      snapshot([
        [6, 0],
        [0, 6],
        [1, 0],
      ]),
    );
    expect("problems" in withGames).toBe(true);

    const read = interpretSnapshot(decider, {
      sets: [
        { tracked: 6, opponent: 0, tiebreak: null },
        { tracked: 0, opponent: 6, tiebreak: null },
        { tracked: 0, opponent: 0, tiebreak: { tracked: 4, opponent: 2 } },
      ],
      game: null,
    });
    expect("board" in read).toBe(true);
  });

  test("refuses more sets than the format plays", () => {
    const read = interpretSnapshot(
      match,
      snapshot([
        [6, 0],
        [0, 6],
        [6, 0],
        [1, 0],
      ]),
    );
    expect("problems" in read).toBe(true);
  });

  test("a board round-trips through its own snapshot", () => {
    const { board } = play("traditional", [...cleanGames(true, 6), ...cleanGames(true, 2), true]);
    expect(snapshotOf(board)).toEqual({
      sets: [
        { tracked: 6, opponent: 0, tiebreak: null },
        { tracked: 2, opponent: 0, tiebreak: null },
      ],
      game: { tracked: 1, opponent: 0 },
    });
  });
});

describe("checkpoints", () => {
  test("applying one moves the score to what the coach declared", () => {
    const match = matchOf();
    const board = initialBoard(match);
    // 4-2 with the opponent serving next: 6 games played, so slot 6 is the opponent's.
    const applied = applyCheckpoint(
      match,
      board,
      checkpointOf(match.matchId, snapshot([[4, 2]]), "TRACKED"),
    );
    expect("board" in applied).toBe(true);
    if (!("board" in applied)) return;
    expect(applied.board.currentSet?.trackedGames).toBe(4);
    expect(nextServerFor(applied.board)).toBe("TRACKED");
  });

  test("declared games are never counted as observed", () => {
    const match = matchOf();
    const applied = applyCheckpoint(
      match,
      initialBoard(match),
      checkpointOf(match.matchId, snapshot([[4, 2]])),
    );
    if (!("board" in applied)) throw new Error("expected a board");
    expect(applied.board.currentSet?.slotsPlayed).toBe(6);
    expect(applied.board.currentSet?.slotsObserved).toBe(0);
    expect(observedOf(applied.board.currentSet ?? { slotsPlayed: 0, slotsObserved: 0 })).toBe(
      "none",
    );
  });

  test("games already watched stay watched when a later checkpoint keeps them", () => {
    const { match, board } = play("traditional", cleanGames(true, 2));
    expect(board.currentSet?.slotsObserved).toBe(2);
    const applied = applyCheckpoint(match, board, checkpointOf(match.matchId, snapshot([[4, 2]])));
    if (!("board" in applied)) throw new Error("expected a board");
    expect(applied.board.currentSet?.slotsObserved).toBe(2);
    expect(applied.board.currentSet?.slotsPlayed).toBe(6);
    expect(observedOf(applied.board.currentSet ?? { slotsPlayed: 0, slotsObserved: 0 })).toBe(
      "partial",
    );
  });

  test("a correction that shrinks the score can't leave more observed than played", () => {
    const { match, board } = play("traditional", cleanGames(true, 4));
    const applied = applyCheckpoint(match, board, checkpointOf(match.matchId, snapshot([[1, 0]])));
    if (!("board" in applied)) throw new Error("expected a board");
    expect(applied.board.currentSet?.slotsPlayed).toBe(1);
    expect(applied.board.currentSet?.slotsObserved).toBe(1);
  });

  test("the serving answer is cross-checked against the score", () => {
    const match = matchOf();
    const board = initialBoard(match);
    // 6 games played from a tracked-first toss puts the tracked player on serve.
    const wrong = validateCheckpoint(
      match,
      board,
      checkpointOf(match.matchId, snapshot([[4, 2]]), "OPPONENT"),
      { hasEvents: true },
    );
    expect(wrong).toHaveLength(1);
    expect(wrong[0]?.cell).toBe("servesNext");
    expect(wrong[0]?.message).toMatch(/serving order changed on court/);

    const right = validateCheckpoint(
      match,
      board,
      checkpointOf(match.matchId, snapshot([[4, 2]]), "TRACKED"),
      { hasEvents: true },
    );
    expect(right).toEqual([]);
  });

  test("on an empty log the answer defines who served first instead", () => {
    const match = matchOf();
    const board = initialBoard(match);
    expect(
      validateCheckpoint(
        match,
        board,
        checkpointOf(match.matchId, snapshot([[4, 2]]), "OPPONENT"),
        { hasEvents: false },
      ),
    ).toEqual([]);
    expect(firstServerImpliedBy(boardOf(match, snapshot([[4, 2]])), "OPPONENT")).toBe("OPPONENT");
    expect(firstServerImpliedBy(boardOf(match, snapshot([[4, 2]])), "TRACKED")).toBe("TRACKED");
  });

  test("an explicit order change re-anchors the rotation rather than refusing", () => {
    const match = matchOf();
    const board = initialBoard(match);
    const checkpoint = checkpointOf(match.matchId, snapshot([[4, 2]]), "OPPONENT", true);
    expect(validateCheckpoint(match, board, checkpoint, { hasEvents: true })).toEqual([]);

    const applied = applyCheckpoint(match, board, checkpoint);
    if (!("board" in applied)) throw new Error("expected a board");
    expect(nextServerFor(applied.board)).toBe("OPPONENT");
    // And the new order holds for the game after it, not just the one declared.
    const nextGame = cleanGames(true, 1).reduce(
      (current, won) => applyPoint(match, current, won),
      applied.board,
    );
    expect(nextServerFor(nextGame)).toBe("TRACKED");
  });

  test("a checkpoint that changes nothing is refused", () => {
    const { match, board } = play("traditional", cleanGames(true, 2));
    const problems = validateCheckpoint(
      match,
      board,
      checkpointOf(match.matchId, snapshotOf(board)),
      { hasEvents: true },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/already the score/);
  });
});

describe("the fold over a whole log", () => {
  function pointAt(matchId: string, sequence: number, won: boolean) {
    return Point.create({
      id: `point-${String(sequence)}`,
      matchId,
      timestamp: 1_700_000_000_000 + sequence,
      sequence,
      server: "TRACKED",
      courtSide: "DEUCE",
      won,
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

  test("points and checkpoints fold together in sequence order", () => {
    const match = matchOf();
    const events = [
      pointAt(match.matchId, 0, true),
      ScoreCheckpoint.create({
        id: "checkpoint-1",
        matchId: match.matchId,
        timestamp: 1,
        sequence: 1,
        after: snapshot([[4, 2]]),
        servesNext: "TRACKED",
        orderChanged: false,
      }),
      pointAt(match.matchId, 2, true),
    ];
    const board = foldScore(match, events);
    expect(board.currentSet?.trackedGames).toBe(4);
    expect(board.game).toEqual({ tracked: 1, opponent: 0 });
    expect(board.ignored).toEqual([]);
  });

  test("an event out of order, or from another match, is ignored rather than thrown", () => {
    const match = matchOf();
    const board = foldScore(match, [
      pointAt(match.matchId, 5, true),
      pointAt(match.matchId, 1, true),
      pointAt("some-other-match", 6, true),
    ]);
    expect(board.game).toEqual({ tracked: 1, opponent: 0 });
    expect(board.ignored).toHaveLength(2);
  });

  test("points past a decided match are ignored, not thrown", () => {
    const match = matchOf("pro_set");
    const events = Array.from({ length: 33 }, (_, index) => pointAt(match.matchId, index, true));
    const board = foldScore(match, events);
    expect(board.matchWinner).toBe("TRACKED");
    expect(board.ignored).toHaveLength(1);
    expect(board.ignored[0]?.reason).toMatch(/already decided/);
  });

  test("a checkpoint the fold can't read is ignored, and the board survives", () => {
    const match = matchOf();
    const board = foldScore(match, [
      ScoreCheckpoint.create({
        id: "checkpoint-1",
        matchId: match.matchId,
        timestamp: 1,
        sequence: 0,
        after: snapshot([[7, 4]]),
        servesNext: "TRACKED",
        orderChanged: false,
      }),
    ]);
    expect(board.ignored).toHaveLength(1);
    expect(board.currentSet?.trackedGames).toBe(0);
  });
});

describe("stamps", () => {
  const match = matchOf();

  function stampsAt(wins: boolean[], server: Server, won: boolean): PointContext {
    const { board } = play("traditional", wins);
    return contextFor(match, board, server, won);
  }

  test("a point mid-game is none of them", () => {
    const context = stampsAt([true], "TRACKED", true);
    expect(context).toMatchObject({
      setNumber: 1,
      gameNumber: 1,
      inTiebreak: false,
      isGamePoint: false,
      isBreakPoint: false,
      isSetPoint: false,
      isMatchPoint: false,
      isGameEnd: false,
      isSetEnd: false,
    });
  });

  test("40-0 on serve is a game point, not a break point", () => {
    const context = stampsAt([true, true, true], "TRACKED", true);
    expect(context.isGamePoint).toBe(true);
    expect(context.isBreakPoint).toBe(false);
    expect(context.isGameEnd).toBe(true);
  });

  test("0-40 on serve is a break point, not a game point", () => {
    const context = stampsAt([false, false, false], "TRACKED", false);
    expect(context.isBreakPoint).toBe(true);
    expect(context.isGamePoint).toBe(false);
    expect(context.isGameEnd).toBe(true);
  });

  test("no-ad deuce is both at once", () => {
    const noAd = matchOf("no_ad_scoring");
    const { board } = play("no_ad_scoring", [true, true, true, false, false, false]);
    const context = contextFor(noAd, board, "TRACKED", true);
    expect(context.isGamePoint).toBe(true);
    expect(context.isBreakPoint).toBe(true);
  });

  test("ad scoring at deuce is neither — two points are still needed", () => {
    const context = stampsAt([true, true, true, false, false, false], "TRACKED", true);
    expect(context.isGamePoint).toBe(false);
    expect(context.isBreakPoint).toBe(false);
  });

  test("serving for the set stamps a set point, and winning it stamps the end", () => {
    const wins = [...cleanGames(true, 5), ...cleanGames(false, 1), true, true, true];
    const context = stampsAt(wins, "TRACKED", true);
    expect(context.setNumber).toBe(1);
    expect(context.gameNumber).toBe(7);
    expect(context.isSetPoint).toBe(true);
    expect(context.isSetEnd).toBe(true);
    expect(context.isMatchPoint).toBe(false);
  });

  test("a set point for the receiver is still a set point", () => {
    const wins = [...cleanGames(false, 5), ...cleanGames(true, 1), false, false, false];
    const context = stampsAt(wins, "TRACKED", false);
    expect(context.isSetPoint).toBe(true);
    expect(context.isBreakPoint).toBe(true);
  });

  test("the last point of a match stamps a match point and the set end", () => {
    const wins = [...cleanGames(true, 6), ...cleanGames(true, 5), true, true, true];
    const context = stampsAt(wins, "TRACKED", true);
    expect(context.setNumber).toBe(2);
    expect(context.isMatchPoint).toBe(true);
    expect(context.isSetEnd).toBe(true);
  });

  test("inside a breaker the stamps answer for the breaker as its own game", () => {
    const wins = [...alternating(12), ...Array<boolean>(6).fill(true)];
    const context = stampsAt(wins, "TRACKED", true);
    expect(context.inTiebreak).toBe(true);
    expect(context.gameNumber).toBe(13);
    expect(context.isGamePoint).toBe(true);
    expect(context.isSetPoint).toBe(true);
    expect(context.isGameEnd).toBe(true);
  });
});

describe("scoreboardFor", () => {
  test("a brand-new match is love-all: one games column, one call column", () => {
    const { match, board } = play("traditional", []);
    expect(scoreboardFor(match, board)).toEqual({
      trackedPlayer: ["0", "0"],
      opponent: ["0", "0"],
      observed: ["full", null],
    });
  });

  test("the call column reads deuce and advantage", () => {
    const { match, board } = play("traditional", [true, true, true, false, false, false]);
    expect(scoreboardFor(match, board).trackedPlayer).toEqual(["0", "40"]);

    const { match: adMatch, board: ad } = play("traditional", [
      true,
      true,
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(scoreboardFor(adMatch, ad).trackedPlayer).toEqual(["0", "AD"]);
  });

  test("a completed set keeps its own column and the live set gains one", () => {
    const { match, board } = play("traditional", [...cleanGames(true, 6), ...cleanGames(true, 1)]);
    expect(scoreboardFor(match, board)).toMatchObject({
      trackedPlayer: ["6", "1", "0"],
      opponent: ["0", "0", "0"],
    });
  });

  test("a breaker shows its points in the call column", () => {
    const { match, board } = play("traditional", [...alternating(12), true, true]);
    expect(scoreboardFor(match, board)).toMatchObject({
      trackedPlayer: ["6", "2"],
      opponent: ["6", "0"],
    });
  });

  test("a match-tiebreak decider shows its breaker in brackets once complete", () => {
    const { match, board } = play("match_tiebreak_10_points", [
      ...cleanGames(true, 6),
      ...cleanGames(false, 6),
      ...Array<boolean>(10).fill(true),
    ]);
    expect(scoreboardFor(match, board).trackedPlayer).toEqual(["6", "0", "[10]"]);
  });

  test("a declared set is marked as not fully watched", () => {
    const match = matchOf();
    const applied = applyCheckpoint(
      match,
      initialBoard(match),
      checkpointOf(
        match.matchId,
        snapshot([
          [6, 3],
          [0, 0],
        ]),
      ),
    );
    if (!("board" in applied)) throw new Error("expected a board");
    expect(scoreboardFor(match, applied.board).observed[0]).toBe("none");
  });
});

describe("coverage", () => {
  test("counts watched games against played ones across the whole match", () => {
    const { match, board } = play("traditional", cleanGames(true, 2));
    expect(coverageOf(board)).toEqual({ slotsPlayed: 2, slotsObserved: 2 });

    const applied = applyCheckpoint(
      match,
      board,
      checkpointOf(
        match.matchId,
        snapshot([
          [6, 3],
          [0, 0],
        ]),
      ),
    );
    if (!("board" in applied)) throw new Error("expected a board");
    expect(coverageOf(applied.board)).toEqual({ slotsPlayed: 9, slotsObserved: 2 });
  });
});
