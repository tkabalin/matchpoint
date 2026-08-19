import { describe, expect, test } from "vitest";

import { MatchSet } from "./match-set";
import { Point } from "./point";
import {
  gameStateFor,
  isAdScoringFor,
  matchRulesFor,
  matchStateFor,
  maxSetsFor,
  setRulesFor,
  setStateFor,
} from "./state";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

describe("maxSetsFor", () => {
  test.each([
    ["traditional", 3],
    ["mens_grand_slam", 5],
    ["womens_grand_slam", 3],
    ["no_ad_scoring", 3],
    ["match_tiebreak_10_points", 3],
    ["short_sets", 3],
    ["pro_set", 1],
    ["legacy", 3],
  ] as const)("%s's max sets is %i", (scoringSystem, expected) => {
    expect(maxSetsFor(scoringSystem)).toBe(expected);
  });
});

describe("matchRulesFor", () => {
  test.each([
    ["traditional", 2, 3],
    ["mens_grand_slam", 3, 5],
    ["womens_grand_slam", 2, 3],
    ["no_ad_scoring", 2, 3],
    ["match_tiebreak_10_points", 2, 3],
    ["short_sets", 2, 3],
    ["pro_set", 1, 1],
    ["legacy", 2, 3],
  ] as const)(
    "%s needs %i sets to win, out of %i playable",
    (scoringSystem, setsToWin, maxSets) => {
      expect(matchRulesFor(scoringSystem)).toEqual({ setsToWin, maxSets });
    },
  );

  test("mens_grand_slam and womens_grand_slam diverge on setsToWin — the entire reason they're separate systems", () => {
    // A copy-paste bug giving both 2 would pass every other test in this
    // suite, since nothing else distinguishes the two.
    expect(matchRulesFor("mens_grand_slam").setsToWin).toBe(3);
    expect(matchRulesFor("womens_grand_slam").setsToWin).toBe(2);
    expect(matchRulesFor("mens_grand_slam").setsToWin).not.toBe(
      matchRulesFor("womens_grand_slam").setsToWin,
    );
  });
});

describe("isAdScoringFor", () => {
  test.each([
    ["traditional", true],
    ["mens_grand_slam", true],
    ["womens_grand_slam", true],
    ["no_ad_scoring", false],
    ["match_tiebreak_10_points", true],
    ["short_sets", false],
    ["pro_set", true],
    ["legacy", true],
  ] as const)("%s is ad scoring: %s", (scoringSystem, expected) => {
    expect(isAdScoringFor(scoringSystem)).toBe(expected);
  });
});

describe("setRulesFor", () => {
  test.each([
    ["traditional", 6, 6, 7],
    ["no_ad_scoring", 6, 6, 7],
    ["short_sets", 4, 3, 5],
    ["pro_set", 8, 8, 7],
  ] as const)(
    "%s's non-deciding set: %i games, tiebreak at %i, target %i",
    (scoringSystem, gamesToWin, tiebreakAt, tiebreakTarget) => {
      // setNumber 1 of a 3-set match — never the decider for these systems.
      const rules = setRulesFor(scoringSystem, 1, 3);
      expect(rules).toEqual({ gamesToWin, tiebreakAt, tiebreakTarget });
    },
  );

  test("mens_grand_slam's regular set uses a 7-point breaker", () => {
    const rules = setRulesFor("mens_grand_slam", 1, 5);
    expect(rules).toEqual({ gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 7 });
  });

  test("mens_grand_slam's decider uses a 10-point breaker", () => {
    const rules = setRulesFor("mens_grand_slam", 5, 5);
    expect(rules).toEqual({ gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 10 });
  });

  test("set 3 of a best-of-5 mens_grand_slam match is NOT the decider", () => {
    // maxSets must mean total sets playable (5), not sets needed to win (3) —
    // using the wrong definition would make this setNumber === maxSets and
    // silently resolve the wrong (10-point) target here.
    const rules = setRulesFor("mens_grand_slam", 3, 5);
    expect(rules.tiebreakTarget).toBe(7);
  });

  test("womens_grand_slam's decider (best-of-3) uses a 10-point breaker", () => {
    const rules = setRulesFor("womens_grand_slam", 3, 3);
    expect(rules).toEqual({ gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 10 });
  });

  test("legacy's regular set tiebreaks normally at 6-6", () => {
    const rules = setRulesFor("legacy", 1, 3);
    expect(rules.tiebreakAt).toBe(6);
  });

  test("legacy's decider has no tiebreak at all", () => {
    const rules = setRulesFor("legacy", 3, 3);
    expect(rules).toEqual({ gamesToWin: 6, tiebreakAt: null, tiebreakTarget: 7 });
  });

  test("match_tiebreak_10_points' regular set plays normally", () => {
    const rules = setRulesFor("match_tiebreak_10_points", 1, 3);
    expect(rules).toEqual({ gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 7 });
  });

  test("match_tiebreak_10_points' decider is a single breaker — no games phase", () => {
    const rules = setRulesFor("match_tiebreak_10_points", 3, 3);
    expect(rules).toEqual({ gamesToWin: 0, tiebreakAt: 0, tiebreakTarget: 10 });
  });

  describe("validation", () => {
    test.each([0, -1, 1.5])("rejects a setNumber of %s", (setNumber) => {
      expect(() => setRulesFor("traditional", setNumber, 3)).toThrow(/setNumber/);
    });

    test.each([0, -1, 1.5])("rejects a maxSets of %s", (maxSets) => {
      expect(() => setRulesFor("traditional", 1, maxSets)).toThrow(/maxSets/);
    });

    test("rejects setNumber greater than maxSets", () => {
      expect(() => setRulesFor("traditional", 4, 3)).toThrow(/cannot exceed/);
    });
  });
});

// Monotonically increasing across the whole file — gameStateFor/setStateFor only care
// that points passed together are in non-decreasing sequence order, not about the
// absolute values, so a single shared counter keeps every fixture trivially valid.
let nextSequence = 0;

/** A won point, minimal otherwise — override just the fields a test cares about. */
function pointWonBy(winner: string, overrides: Record<string, unknown> = {}) {
  const sequence = nextSequence;
  nextSequence += 1;
  return Point.create({
    id: `point-${crypto.randomUUID()}`,
    matchId: MATCH_ID,
    timestamp: 1_700_000_000_000 + sequence,
    sequence,
    server: "TRACKED",
    serves: [{ number: 1, outcome: "IN", location: { box: "DEUCE", target: "T" } }],
    returnOutcome: null,
    won: winner === TRACKED_ID,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    wing: null,
    shotType: null,
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "MID" },
    rallyLengthBucket: null,
    ...overrides,
  });
}

function pointsFor(trackedPlayerWins: number, opponentWins: number) {
  return [
    ...Array.from({ length: trackedPlayerWins }, () => pointWonBy(TRACKED_ID)),
    ...Array.from({ length: opponentWins }, () => pointWonBy(OPPONENT_ID)),
  ];
}

describe("gameStateFor", () => {
  test("an empty game is 0-0 with no winner", () => {
    const state = gameStateFor([], TRACKED_ID, OPPONENT_ID, true);
    expect(state).toEqual({ trackedPlayerPoints: 0, opponentPoints: 0, winner: null });
  });

  test("counts points won by each side", () => {
    const state = gameStateFor(pointsFor(2, 1), TRACKED_ID, OPPONENT_ID, true);
    expect(state.trackedPlayerPoints).toBe(2);
    expect(state.opponentPoints).toBe(1);
  });

  describe("ad scoring", () => {
    test.each([
      [4, 0],
      [4, 1],
      [4, 2],
      [5, 3],
    ])("%i-%i is a tracked-player win", (trackedPlayerWins, opponentWins) => {
      const state = gameStateFor(
        pointsFor(trackedPlayerWins, opponentWins),
        TRACKED_ID,
        OPPONENT_ID,
        true,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("4-3 is not a win yet — only a 1-point lead, ad scoring needs 2", () => {
      const state = gameStateFor(pointsFor(4, 3), TRACKED_ID, OPPONENT_ID, true);
      expect(state.winner).toBeNull();
    });

    test("3-3 (deuce) has no winner", () => {
      const state = gameStateFor(pointsFor(3, 3), TRACKED_ID, OPPONENT_ID, true);
      expect(state.winner).toBeNull();
    });

    test("the opponent can win too", () => {
      const state = gameStateFor(pointsFor(2, 4), TRACKED_ID, OPPONENT_ID, true);
      expect(state.winner).toBe(OPPONENT_ID);
    });
  });

  describe("no-ad scoring", () => {
    test("4-3 is a win — first to 4, no margin required", () => {
      const state = gameStateFor(pointsFor(4, 3), TRACKED_ID, OPPONENT_ID, false);
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("3-3 has no winner yet — neither side has reached 4", () => {
      const state = gameStateFor(pointsFor(3, 3), TRACKED_ID, OPPONENT_ID, false);
      expect(state.winner).toBeNull();
    });

    test("the opponent can win too", () => {
      const state = gameStateFor(pointsFor(3, 4), TRACKED_ID, OPPONENT_ID, false);
      expect(state.winner).toBe(OPPONENT_ID);
    });
  });

  describe("consistency checks", () => {
    test("rejects points given out of sequence order", () => {
      const points = [pointWonBy(TRACKED_ID), pointWonBy(TRACKED_ID)].reverse();
      expect(() => gameStateFor(points, TRACKED_ID, OPPONENT_ID, true)).toThrow(/sequence/);
    });
  });
});

// Traditional-shaped rules — 6 games to win, tiebreak at 6-6, 7-point breaker.
const TRADITIONAL_RULES = { gamesToWin: 6, tiebreakAt: 6, tiebreakTarget: 7 };
// legacy's decider — same games-to-win, but no tiebreak at all.
const LEGACY_DECIDER_RULES = { gamesToWin: 6, tiebreakAt: null, tiebreakTarget: 7 };
// match_tiebreak_10_points' decider — no games phase, straight to a 10-point breaker.
const MATCH_TIEBREAK_RULES = { gamesToWin: 0, tiebreakAt: 0, tiebreakTarget: 10 };

/** `count` clean 4-0 games in a row, all won by `winner`. */
function completedGames(winner: string, count: number) {
  return Array.from({ length: count * 4 }, () => pointWonBy(winner));
}

describe("setStateFor", () => {
  test("no points is 0-0 with no winner and no tiebreak", () => {
    const state = setStateFor([], TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
    expect(state).toEqual({
      trackedPlayerGames: 0,
      opponentGames: 0,
      tiebreak: null,
      winner: null,
    });
  });

  test("counts completed games for each side", () => {
    const points = [...completedGames(TRACKED_ID, 3), ...completedGames(OPPONENT_ID, 1)];
    const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
    expect(state.trackedPlayerGames).toBe(3);
    expect(state.opponentGames).toBe(1);
    expect(state.winner).toBeNull();
  });

  test("an in-progress game doesn't count toward either side", () => {
    const points = [
      ...completedGames(TRACKED_ID, 5),
      pointWonBy(TRACKED_ID), // 1 point, no winner yet
    ];
    const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
    expect(state.trackedPlayerGames).toBe(5);
  });

  describe("traditional-shaped rules", () => {
    test("6-4 is a clean tracked-player win", () => {
      const points = [...completedGames(TRACKED_ID, 6), ...completedGames(OPPONENT_ID, 4)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("6-5 is not a win yet — only a 1-game lead", () => {
      const points = [...completedGames(TRACKED_ID, 6), ...completedGames(OPPONENT_ID, 5)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBeNull();
    });

    test("7-5 is a win", () => {
      const points = [...completedGames(TRACKED_ID, 7), ...completedGames(OPPONENT_ID, 5)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("6-6 with no tiebreak points yet is still in progress", () => {
      const points = [...completedGames(TRACKED_ID, 6), ...completedGames(OPPONENT_ID, 6)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBeNull();
      expect(state.tiebreak).toBeNull();
    });

    test("6-6 decided by the breaker credits the winner an extra game — 7-6, tennis' convention", () => {
      const points = [
        ...completedGames(TRACKED_ID, 6),
        ...completedGames(OPPONENT_ID, 6),
        ...pointsFor(7, 5),
      ];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBe(TRACKED_ID);
      expect(state.trackedPlayerGames).toBe(7);
      expect(state.opponentGames).toBe(6);
      expect(state.tiebreak).toEqual({ trackedPlayerPoints: 7, opponentPoints: 5, target: 7 });
    });

    test("the opponent can win the breaker too", () => {
      const points = [
        ...completedGames(TRACKED_ID, 6),
        ...completedGames(OPPONENT_ID, 6),
        ...pointsFor(5, 7),
      ];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBe(OPPONENT_ID);
      expect(state.opponentGames).toBe(7);
      expect(state.trackedPlayerGames).toBe(6);
    });

    test("a breaker still in progress (not yet at target, or no 2-clear lead) has no winner", () => {
      const points = [
        ...completedGames(TRACKED_ID, 6),
        ...completedGames(OPPONENT_ID, 6),
        ...pointsFor(6, 6),
      ];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.winner).toBeNull();
    });
  });

  describe("legacy's decider — no tiebreak at all", () => {
    test("6-6 is still in progress — no tiebreak triggers", () => {
      const points = [...completedGames(TRACKED_ID, 6), ...completedGames(OPPONENT_ID, 6)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, LEGACY_DECIDER_RULES);
      expect(state.winner).toBeNull();
      expect(state.tiebreak).toBeNull();
    });

    test("8-6 is a win — play continues past 6-6 until a 2-game lead", () => {
      const points = [...completedGames(TRACKED_ID, 8), ...completedGames(OPPONENT_ID, 6)];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, LEGACY_DECIDER_RULES);
      expect(state.winner).toBe(TRACKED_ID);
    });
  });

  describe("match_tiebreak_10_points' decider — no games phase", () => {
    test("decided purely by the breaker; games stay 0-0", () => {
      const points = pointsFor(10, 7);
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, MATCH_TIEBREAK_RULES);
      expect(state.trackedPlayerGames).toBe(0);
      expect(state.opponentGames).toBe(0);
      expect(state.winner).toBe(TRACKED_ID);
      expect(state.tiebreak).toEqual({ trackedPlayerPoints: 10, opponentPoints: 7, target: 10 });
    });

    test("no winner until the breaker itself is decided", () => {
      const points = pointsFor(8, 8);
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, MATCH_TIEBREAK_RULES);
      expect(state.winner).toBeNull();
    });
  });
});

/** A decided (or, with winner: null, in-progress) set, minimal otherwise. */
function matchSetWonBy(winner: string | null, setNumber: number) {
  return MatchSet.create({
    matchId: MATCH_ID,
    setNumber,
    trackedPlayerId: TRACKED_ID,
    opponentId: OPPONENT_ID,
    trackedPlayerGames: winner === TRACKED_ID ? 6 : winner === OPPONENT_ID ? 3 : 2,
    opponentGames: winner === OPPONENT_ID ? 6 : winner === TRACKED_ID ? 3 : 2,
    tiebreak: null,
    winner,
  });
}

/** `trackedPlayerWins` sets won by the tracked player, then `opponentWins` by the opponent. */
function matchSetsFor(trackedPlayerWins: number, opponentWins: number) {
  const sets = [];
  let setNumber = 1;
  for (let index = 0; index < trackedPlayerWins; index += 1, setNumber += 1) {
    sets.push(matchSetWonBy(TRACKED_ID, setNumber));
  }
  for (let index = 0; index < opponentWins; index += 1, setNumber += 1) {
    sets.push(matchSetWonBy(OPPONENT_ID, setNumber));
  }
  return sets;
}

describe("matchStateFor", () => {
  const TRADITIONAL_MATCH_RULES = { setsToWin: 2, maxSets: 3 };
  const GRAND_SLAM_MATCH_RULES = { setsToWin: 3, maxSets: 5 };
  const PRO_SET_MATCH_RULES = { setsToWin: 1, maxSets: 1 };

  test("no sets is 0-0 with no winner", () => {
    const state = matchStateFor([], TRACKED_ID, OPPONENT_ID, TRADITIONAL_MATCH_RULES);
    expect(state).toEqual({ trackedPlayerSets: 0, opponentSets: 0, winner: null });
  });

  test("counts sets won by each side", () => {
    const state = matchStateFor(
      matchSetsFor(1, 1),
      TRACKED_ID,
      OPPONENT_ID,
      TRADITIONAL_MATCH_RULES,
    );
    expect(state.trackedPlayerSets).toBe(1);
    expect(state.opponentSets).toBe(1);
    expect(state.winner).toBeNull();
  });

  test("an in-progress set doesn't count toward either side", () => {
    const sets = [...matchSetsFor(1, 0), matchSetWonBy(null, 2)];
    const state = matchStateFor(sets, TRACKED_ID, OPPONENT_ID, TRADITIONAL_MATCH_RULES);
    expect(state.trackedPlayerSets).toBe(1);
    expect(state.opponentSets).toBe(0);
    expect(state.winner).toBeNull();
  });

  describe("traditional (best-of-3, setsToWin: 2)", () => {
    test("2-0 is a win", () => {
      const state = matchStateFor(
        matchSetsFor(2, 0),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("2-1 is a win", () => {
      const state = matchStateFor(
        matchSetsFor(2, 1),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("1-1 is not decided yet", () => {
      const state = matchStateFor(
        matchSetsFor(1, 1),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBeNull();
    });

    test("the opponent can win too", () => {
      const state = matchStateFor(
        matchSetsFor(0, 2),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBe(OPPONENT_ID);
    });
  });

  describe("mens_grand_slam (best-of-5, setsToWin: 3)", () => {
    test("3-1 is a win", () => {
      const state = matchStateFor(
        matchSetsFor(3, 1),
        TRACKED_ID,
        OPPONENT_ID,
        GRAND_SLAM_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("2-2 is not decided yet — traditional's setsToWin (2) would say otherwise", () => {
      const state = matchStateFor(
        matchSetsFor(2, 2),
        TRACKED_ID,
        OPPONENT_ID,
        GRAND_SLAM_MATCH_RULES,
      );
      expect(state.winner).toBeNull();
    });
  });

  test("pro_set (setsToWin: 1) is decided by a single set", () => {
    const state = matchStateFor(matchSetsFor(1, 0), TRACKED_ID, OPPONENT_ID, PRO_SET_MATCH_RULES);
    expect(state.winner).toBe(TRACKED_ID);
  });

  describe("consistency checks", () => {
    test("rejects sets that don't match the given participants", () => {
      const sets = [
        MatchSet.create({
          matchId: MATCH_ID,
          setNumber: 1,
          trackedPlayerId: "someone-else",
          opponentId: "someone-else-2",
          trackedPlayerGames: 6,
          opponentGames: 4,
          tiebreak: null,
          winner: "someone-else",
        }),
      ];
      expect(() => matchStateFor(sets, TRACKED_ID, OPPONENT_ID, TRADITIONAL_MATCH_RULES)).toThrow(
        /match the given participants/,
      );
    });
  });
});
