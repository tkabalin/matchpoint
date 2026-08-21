import { describe, expect, test } from "vitest";

import { createMatch } from "./match";
import type { MatchOutcomeOverride, ScoringSystem } from "./match";
import { MatchSet } from "./match-set";
import { Point } from "./point";
import {
  finalWinnerFor,
  gameStateFor,
  isAdScoringFor,
  isTiebreakFor,
  matchRulesFor,
  matchSetsFor,
  matchStateFor,
  maxSetsFor,
  nextCourtSideFor,
  nextServerFor,
  scoreboardFor,
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
    courtSide: "DEUCE",
    serves: [{ number: 1, outcome: "IN", location: "T" }],
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
      currentGamePoints: 0,
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

  describe("currentGamePoints", () => {
    test("0 right after a completed game — a fresh boundary, no game started yet", () => {
      const points = completedGames(TRACKED_ID, 2);
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.currentGamePoints).toBe(0);
    });

    test("counts points already played in the current, not-yet-decided game", () => {
      const points = [
        ...completedGames(TRACKED_ID, 2),
        pointWonBy(TRACKED_ID),
        pointWonBy(OPPONENT_ID),
      ];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.currentGamePoints).toBe(2);
      expect(state.trackedPlayerGames).toBe(2); // the 2 loose points don't complete a 3rd game
    });

    test("0 mid-tiebreak — no regular game is in progress once the breaker starts", () => {
      const points = [
        ...completedGames(TRACKED_ID, 6),
        ...completedGames(OPPONENT_ID, 6),
        ...pointsFor(3, 2),
      ];
      const state = setStateFor(points, TRACKED_ID, OPPONENT_ID, true, TRADITIONAL_RULES);
      expect(state.currentGamePoints).toBe(0);
    });
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
function decidedMatchSets(trackedPlayerWins: number, opponentWins: number) {
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
      decidedMatchSets(1, 1),
      TRACKED_ID,
      OPPONENT_ID,
      TRADITIONAL_MATCH_RULES,
    );
    expect(state.trackedPlayerSets).toBe(1);
    expect(state.opponentSets).toBe(1);
    expect(state.winner).toBeNull();
  });

  test("an in-progress set doesn't count toward either side", () => {
    const sets = [...decidedMatchSets(1, 0), matchSetWonBy(null, 2)];
    const state = matchStateFor(sets, TRACKED_ID, OPPONENT_ID, TRADITIONAL_MATCH_RULES);
    expect(state.trackedPlayerSets).toBe(1);
    expect(state.opponentSets).toBe(0);
    expect(state.winner).toBeNull();
  });

  describe("traditional (best-of-3, setsToWin: 2)", () => {
    test("2-0 is a win", () => {
      const state = matchStateFor(
        decidedMatchSets(2, 0),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("2-1 is a win", () => {
      const state = matchStateFor(
        decidedMatchSets(2, 1),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("1-1 is not decided yet", () => {
      const state = matchStateFor(
        decidedMatchSets(1, 1),
        TRACKED_ID,
        OPPONENT_ID,
        TRADITIONAL_MATCH_RULES,
      );
      expect(state.winner).toBeNull();
    });

    test("the opponent can win too", () => {
      const state = matchStateFor(
        decidedMatchSets(0, 2),
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
        decidedMatchSets(3, 1),
        TRACKED_ID,
        OPPONENT_ID,
        GRAND_SLAM_MATCH_RULES,
      );
      expect(state.winner).toBe(TRACKED_ID);
    });

    test("2-2 is not decided yet — traditional's setsToWin (2) would say otherwise", () => {
      const state = matchStateFor(
        decidedMatchSets(2, 2),
        TRACKED_ID,
        OPPONENT_ID,
        GRAND_SLAM_MATCH_RULES,
      );
      expect(state.winner).toBeNull();
    });
  });

  test("pro_set (setsToWin: 1) is decided by a single set", () => {
    const state = matchStateFor(
      decidedMatchSets(1, 0),
      TRACKED_ID,
      OPPONENT_ID,
      PRO_SET_MATCH_RULES,
    );
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

describe("isTiebreakFor", () => {
  test.each([
    [5, 5, false],
    [6, 5, false], // at the threshold but not tied
    [6, 6, true],
    [7, 6, false], // post-breaker, credited score — no longer "at" the threshold
  ] as const)(
    "%i-%i under traditional rules: isTiebreak=%s",
    (trackedPlayerGames, opponentGames, expected) => {
      const rules = setRulesFor("traditional", 1, 3);
      expect(
        isTiebreakFor(
          { trackedPlayerGames, opponentGames, tiebreak: null, winner: null, currentGamePoints: 0 },
          rules,
        ),
      ).toBe(expected);
    },
  );

  test("legacy's decider never enters a tiebreak, even tied high", () => {
    const rules = setRulesFor("legacy", 3, 3);
    expect(
      isTiebreakFor(
        {
          trackedPlayerGames: 10,
          opponentGames: 10,
          tiebreak: null,
          winner: null,
          currentGamePoints: 0,
        },
        rules,
      ),
    ).toBe(false);
  });

  test("match_tiebreak_10_points' decider is always a tiebreak, even at 0-0", () => {
    const rules = setRulesFor("match_tiebreak_10_points", 3, 3);
    expect(
      isTiebreakFor(
        {
          trackedPlayerGames: 0,
          opponentGames: 0,
          tiebreak: null,
          winner: null,
          currentGamePoints: 0,
        },
        rules,
      ),
    ).toBe(true);
  });

  test("true even with zero breaker points played — not simply tiebreak !== null", () => {
    // setStateFor only builds a TiebreakScore once a breaker point exists, but the
    // next point still has to follow tiebreak serving rules the instant games-all
    // is reached. This is the exact subtlety nextServerFor depends on.
    const rules = setRulesFor("traditional", 1, 3);
    const state = {
      trackedPlayerGames: 6,
      opponentGames: 6,
      tiebreak: null,
      winner: null,
      currentGamePoints: 0,
    };
    expect(state.tiebreak).toBeNull();
    expect(isTiebreakFor(state, rules)).toBe(true);
  });
});

describe("matchSetsFor", () => {
  test("no points: 0-0, current set 1, no completed sets", () => {
    const result = matchSetsFor([], MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toEqual([]);
    expect(result.currentSet).toEqual({
      setNumber: 1,
      state: {
        trackedPlayerGames: 0,
        opponentGames: 0,
        tiebreak: null,
        winner: null,
        currentGamePoints: 0,
      },
    });
  });

  test("set 1 completes exactly, no points beyond it — currentSet is null", () => {
    // Loser's games first, winner's last: matchSetsFor cuts a set the instant it's
    // decided (unlike setStateFor, which only tallies a final result), so a block
    // of the eventual winner's games followed by the loser's would let the winner
    // decide it early (e.g. 6-0) and turn the loser's games into a false set 2.
    const points = [...completedGames(OPPONENT_ID, 4), ...completedGames(TRACKED_ID, 6)];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toHaveLength(1);
    expect(result.completedSets[0]?.winner).toBe(TRACKED_ID);
    expect(result.completedSets[0]?.setNumber).toBe(1);
    expect(result.currentSet).toBeNull();
  });

  test("set 1 completes, a few set-2 points follow — currentSet reflects set 2", () => {
    const points = [
      ...completedGames(OPPONENT_ID, 4),
      ...completedGames(TRACKED_ID, 6),
      ...completedGames(TRACKED_ID, 1),
    ];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toHaveLength(1);
    expect(result.currentSet).toEqual({
      setNumber: 2,
      state: {
        trackedPlayerGames: 1,
        opponentGames: 0,
        tiebreak: null,
        winner: null,
        currentGamePoints: 0,
      },
    });
  });

  test("a full best-of-3 match decided 2-0 processes both sets with no error", () => {
    const points = [
      ...completedGames(OPPONENT_ID, 4),
      ...completedGames(TRACKED_ID, 6),
      ...completedGames(OPPONENT_ID, 2),
      ...completedGames(TRACKED_ID, 6),
    ];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toHaveLength(2);
    expect(result.completedSets.map((set) => set.winner)).toEqual([TRACKED_ID, TRACKED_ID]);
    expect(result.currentSet).toBeNull();
  });

  test("trusts the input past an already-decided match — a third set for a 2-0 best-of-3 still processes", () => {
    const points = [
      ...completedGames(OPPONENT_ID, 4),
      ...completedGames(TRACKED_ID, 6), // set 1: tracked 6-4
      ...completedGames(OPPONENT_ID, 2),
      ...completedGames(TRACKED_ID, 6), // set 2: tracked 6-2 — match already decided 2-0
      ...completedGames(OPPONENT_ID, 5),
      ...completedGames(TRACKED_ID, 3), // set 3, in progress: opponent 5, tracked 3
    ];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toHaveLength(2);
    expect(result.currentSet).toEqual({
      setNumber: 3,
      state: {
        trackedPlayerGames: 3,
        opponentGames: 5,
        tiebreak: null,
        winner: null,
        currentGamePoints: 0,
      },
    });
  });

  test("points beyond maxSets throw via setRulesFor's own guard", () => {
    const points = [
      ...completedGames(OPPONENT_ID, 4),
      ...completedGames(TRACKED_ID, 6), // set 1: tracked 6-4
      ...completedGames(OPPONENT_ID, 2),
      ...completedGames(TRACKED_ID, 6), // set 2: tracked 6-2 — match already decided 2-0
      ...completedGames(TRACKED_ID, 3),
      ...completedGames(OPPONENT_ID, 6), // set 3: opponent 6-3
      pointWonBy(TRACKED_ID), // a stray point starting a notional set 4
    ];
    expect(() => matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional")).toThrow(
      /cannot exceed/,
    );
  });

  test("a tiebreak-decided set produces a MatchSet with tiebreak populated, 7-6", () => {
    const points = [
      // Reach 6-6 without either side crossing the win threshold early: tracked's
      // first 5 games (5-0, safe — under 6), then all 6 of the opponent's (5-6,
      // opponent reaches 6 but only a 1-game lead — not enough to decide), then
      // tracked's 6th (6-6, ties it and enters the breaker).
      ...completedGames(TRACKED_ID, 5),
      ...completedGames(OPPONENT_ID, 6),
      ...completedGames(TRACKED_ID, 1),
      // Breaker: opponent's points first (0-5, safe — under the 7-point target),
      // then tracked's, which cross it only at the intended 7-5.
      ...Array.from({ length: 5 }, () => pointWonBy(OPPONENT_ID)),
      ...Array.from({ length: 7 }, () => pointWonBy(TRACKED_ID)),
    ];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(result.completedSets).toHaveLength(1);
    const set = result.completedSets[0];
    expect(set?.trackedPlayerGames).toBe(7);
    expect(set?.opponentGames).toBe(6);
    expect(set?.tiebreak).toEqual({ trackedPlayerPoints: 7, opponentPoints: 5, target: 7 });
    expect(set?.winner).toBe(TRACKED_ID);
  });

  test("legacy's decider (set 3) finalizes past 6-6 with no tiebreak, e.g. 8-6", () => {
    const points = [
      ...completedGames(TRACKED_ID, 6), // set 1: tracked 6-0
      ...completedGames(OPPONENT_ID, 6), // set 2: opponent 6-0
      // Set 3 (decider, no tiebreak): reach 6-6 the same safe way as above, then
      // keep extending — tracked's 7th (7-6, only a 1-game lead, still not
      // decided), then its 8th (8-6, a 2-game lead, decided).
      ...completedGames(TRACKED_ID, 5),
      ...completedGames(OPPONENT_ID, 5),
      ...completedGames(TRACKED_ID, 1),
      ...completedGames(OPPONENT_ID, 1),
      ...completedGames(TRACKED_ID, 2),
    ];
    const result = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "legacy");
    expect(result.completedSets).toHaveLength(3);
    const decider = result.completedSets[2];
    expect(decider?.trackedPlayerGames).toBe(8);
    expect(decider?.opponentGames).toBe(6);
    expect(decider?.tiebreak).toBeNull();
    expect(decider?.winner).toBe(TRACKED_ID);
  });

  test("match_tiebreak_10_points' decider (set 3) is a single breaker, games stay 0-0", () => {
    const points = [
      ...completedGames(TRACKED_ID, 6), // set 1: tracked 6-0
      ...completedGames(OPPONENT_ID, 6), // set 2: opponent 6-0
      // Set 3 (decider): straight to the breaker at 0-0 — opponent's points first
      // (safe, under the 10-point target), then tracked's, crossing it at 10-7.
      ...Array.from({ length: 7 }, () => pointWonBy(OPPONENT_ID)),
      ...Array.from({ length: 10 }, () => pointWonBy(TRACKED_ID)),
    ];
    const result = matchSetsFor(
      points,
      MATCH_ID,
      TRACKED_ID,
      OPPONENT_ID,
      "match_tiebreak_10_points",
    );
    expect(result.completedSets).toHaveLength(3);
    const decider = result.completedSets[2];
    expect(decider?.trackedPlayerGames).toBe(0);
    expect(decider?.opponentGames).toBe(0);
    expect(decider?.tiebreak).toEqual({ trackedPlayerPoints: 10, opponentPoints: 7, target: 10 });
    expect(decider?.winner).toBe(TRACKED_ID);
  });

  test("rejects points out of sequence order across the whole match", () => {
    // setStateFor's own per-set check can't catch a reversal once it straddles a set
    // boundary — matchSetsFor needs its own whole-match check.
    const first = pointWonBy(TRACKED_ID);
    const second = pointWonBy(TRACKED_ID);
    expect(() =>
      matchSetsFor([second, first], MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional"),
    ).toThrow(/sequence/);
  });

  test("rejects a point that doesn't belong to the given match", () => {
    const point = pointWonBy(TRACKED_ID, { matchId: "some-other-match" });
    expect(() => matchSetsFor([point], MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional")).toThrow(
      /belong to the given match/,
    );
  });
});

describe("nextServerFor", () => {
  function liveSetsAt(
    trackedPlayerGames: number,
    opponentGames: number,
    completedSets: MatchSet[] = [],
  ) {
    return {
      completedSets,
      currentSet: {
        setNumber: completedSets.length + 1,
        state: {
          trackedPlayerGames,
          opponentGames,
          tiebreak: null,
          winner: null,
          currentGamePoints: 0,
        },
      },
    };
  }

  describe("regular alternation within a set", () => {
    // Only the SUM of games completed this set matters for alternation, so every
    // case attributes them all to the tracked player for a clean table.
    test.each([
      [0, TRACKED_ID, TRACKED_ID],
      [1, TRACKED_ID, OPPONENT_ID],
      [2, TRACKED_ID, TRACKED_ID],
      [3, TRACKED_ID, OPPONENT_ID],
      [4, TRACKED_ID, TRACKED_ID],
      [5, TRACKED_ID, OPPONENT_ID],
      [0, OPPONENT_ID, OPPONENT_ID],
      [1, OPPONENT_ID, TRACKED_ID],
      [3, OPPONENT_ID, TRACKED_ID],
    ] as const)(
      "%i games completed this set, firstServer=%s -> server=%s",
      (gamesCompleted, firstServer, expected) => {
        const liveSets = liveSetsAt(gamesCompleted, 0);
        expect(nextServerFor(liveSets, "traditional", firstServer, TRACKED_ID, OPPONENT_ID)).toBe(
          expected,
        );
      },
    );
  });

  describe("tiebreak entry — the breaker's own first server matches plain alternation", () => {
    test("traditional: tiebreakAt 6, tied 6-6, zero breaker points played", () => {
      const liveSets = liveSetsAt(6, 6);
      // 12 games completed this set -> even -> firstServer serves the breaker.
      expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        TRACKED_ID,
      );
    });

    test("short_sets: tiebreakAt 3, tied 3-3", () => {
      const liveSets = liveSetsAt(3, 3);
      // 6 games completed -> even -> firstServer serves.
      expect(nextServerFor(liveSets, "short_sets", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        TRACKED_ID,
      );
    });

    test("match_tiebreak_10_points' decider: immediately in the breaker at 0-0", () => {
      const set1 = MatchSet.create({
        matchId: MATCH_ID,
        setNumber: 1,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        trackedPlayerGames: 6,
        opponentGames: 0,
        tiebreak: null,
        winner: TRACKED_ID,
      });
      const set2 = MatchSet.create({
        matchId: MATCH_ID,
        setNumber: 2,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        trackedPlayerGames: 0,
        opponentGames: 6,
        tiebreak: null,
        winner: OPPONENT_ID,
      });
      const liveSets = liveSetsAt(0, 0, [set1, set2]);
      // slots: 6 + 6 = 12 (even), plus 0 completed games this set -> firstServer.
      expect(
        nextServerFor(liveSets, "match_tiebreak_10_points", TRACKED_ID, TRACKED_ID, OPPONENT_ID),
      ).toBe(TRACKED_ID);
    });
  });

  describe("tiebreak-internal rotation", () => {
    function liveSetsInTiebreak(pointsPlayed: number) {
      return {
        completedSets: [],
        currentSet: {
          setNumber: 1,
          state: {
            trackedPlayerGames: 6,
            opponentGames: 6,
            tiebreak:
              pointsPlayed === 0
                ? null
                : { trackedPlayerPoints: pointsPlayed, opponentPoints: 0, target: 7 },
            winner: null,
            currentGamePoints: 0,
          },
        },
      };
    }

    // Point 1 -> A, 2-3 -> B, 4-5 -> A, 6-7 -> B, 8 -> A. A is TRACKED_ID here since
    // 12 completed games this set is even (firstServer serves the breaker — see the
    // "tiebreak entry" block above).
    test.each([
      [0, TRACKED_ID],
      [1, OPPONENT_ID],
      [2, OPPONENT_ID],
      [3, TRACKED_ID],
      [4, TRACKED_ID],
      [5, OPPONENT_ID],
      [6, OPPONENT_ID],
      [7, TRACKED_ID],
    ] as const)("%i tiebreak points played -> server=%s", (pointsPlayed, expected) => {
      const liveSets = liveSetsInTiebreak(pointsPlayed);
      expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        expected,
      );
    });
  });

  describe("tiebreak exit into the next set", () => {
    test("a 7-6 breaker-decided set flips server for the next set's game 1", () => {
      const set1 = MatchSet.create({
        matchId: MATCH_ID,
        setNumber: 1,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        trackedPlayerGames: 7,
        opponentGames: 6,
        tiebreak: { trackedPlayerPoints: 7, opponentPoints: 5, target: 7 },
        winner: TRACKED_ID,
      });
      const liveSets = { completedSets: [set1], currentSet: null };
      // slots = 13 (odd) -> the other player from firstServer opens set 2.
      expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        OPPONENT_ID,
      );
    });

    test("short_sets: a 4-3 breaker-decided set (tiebreakAt 3) also flips", () => {
      const set1 = MatchSet.create({
        matchId: MATCH_ID,
        setNumber: 1,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        trackedPlayerGames: 4,
        opponentGames: 3,
        tiebreak: { trackedPlayerPoints: 5, opponentPoints: 3, target: 5 },
        winner: TRACKED_ID,
      });
      const liveSets = { completedSets: [set1], currentSet: null };
      // slots = 7 (odd) -> flips.
      expect(nextServerFor(liveSets, "short_sets", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        OPPONENT_ID,
      );
    });

    test("a straight 6-2 set (no breaker) does NOT flip — even game count preserves parity", () => {
      const set1 = MatchSet.create({
        matchId: MATCH_ID,
        setNumber: 1,
        trackedPlayerId: TRACKED_ID,
        opponentId: OPPONENT_ID,
        trackedPlayerGames: 6,
        opponentGames: 2,
        tiebreak: null,
        winner: TRACKED_ID,
      });
      const liveSets = { completedSets: [set1], currentSet: null };
      // slots = 8 (even) -> the same player who opened set 1 opens set 2.
      expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
        TRACKED_ID,
      );
    });
  });

  test("full match, checked at four points: set 1 = 6-4 (no tiebreak), set 2 = 7-6 (tiebreak)", () => {
    const midSet1Points = [...completedGames(TRACKED_ID, 3)];
    let liveSets = matchSetsFor(midSet1Points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    // 3 games completed -> odd -> flips from firstServer.
    expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
      OPPONENT_ID,
    );

    // Loser's games first, winner's last — see matchSetsFor's own tests for why.
    const set1Points = [...completedGames(OPPONENT_ID, 4), ...completedGames(TRACKED_ID, 6)];
    liveSets = matchSetsFor(set1Points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(liveSets.currentSet).toBeNull();
    // 10 games (6-4) -> even -> same player who opened set 1 opens set 2.
    expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
      TRACKED_ID,
    );

    const midTiebreakPoints = [
      ...set1Points,
      // Reach 6-6 without an early decision — see the matchSetsFor tiebreak test.
      ...completedGames(TRACKED_ID, 5),
      ...completedGames(OPPONENT_ID, 6),
      ...completedGames(TRACKED_ID, 1),
      ...Array.from({ length: 2 }, () => pointWonBy(OPPONENT_ID)),
      ...Array.from({ length: 3 }, () => pointWonBy(TRACKED_ID)), // 5 tiebreak points played so far
    ];
    liveSets = matchSetsFor(midTiebreakPoints, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(liveSets.currentSet).not.toBeNull();
    // set 2's 12 completed games -> even -> firstServer opened the breaker; 5 points
    // played -> next point 6 -> the other player.
    expect(nextServerFor(liveSets, "traditional", TRACKED_ID, TRACKED_ID, OPPONENT_ID)).toBe(
      OPPONENT_ID,
    );
  });
});

describe("nextCourtSideFor", () => {
  test("a brand-new match (no current set at all) is game 1, point 1 — always deuce", () => {
    const liveSets = { completedSets: [], currentSet: null };
    expect(nextCourtSideFor(liveSets, "traditional")).toBe("DEUCE");
  });

  describe("regular game — alternates by points played so far this game", () => {
    test.each([
      [0, "DEUCE"],
      [1, "AD"],
      [2, "DEUCE"],
      [3, "AD"],
      [4, "DEUCE"],
    ] as const)("%i points played -> %s", (currentGamePoints, expected) => {
      const liveSets = {
        completedSets: [],
        currentSet: {
          setNumber: 1,
          state: {
            trackedPlayerGames: 0,
            opponentGames: 0,
            tiebreak: null,
            winner: null,
            currentGamePoints,
          },
        },
      };
      expect(nextCourtSideFor(liveSets, "traditional")).toBe(expected);
    });
  });

  describe("mid-tiebreak — alternates by points played so far in the breaker instead", () => {
    test.each([
      [0, "DEUCE"],
      [1, "AD"],
      [2, "DEUCE"],
      [3, "AD"],
    ] as const)("%i breaker points played -> %s", (pointsPlayed, expected) => {
      const liveSets = {
        completedSets: [],
        currentSet: {
          setNumber: 1,
          state: {
            trackedPlayerGames: 6,
            opponentGames: 6,
            tiebreak:
              pointsPlayed === 0
                ? null
                : { trackedPlayerPoints: pointsPlayed, opponentPoints: 0, target: 7 },
            winner: null,
            currentGamePoints: 0,
          },
        },
      };
      // Zero breaker points played yet is still correctly "in the breaker" — the
      // same subtlety isTiebreakFor's own tests cover (tiebreak stays null until a
      // breaker point exists, but the rule already applies).
      expect(nextCourtSideFor(liveSets, "traditional")).toBe(expected);
    });
  });

  test("composes with matchSetsFor end to end: 3 points into a fresh match's first game", () => {
    const points = Array.from({ length: 3 }, () => pointWonBy(TRACKED_ID));
    const liveSets = matchSetsFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(liveSets.currentSet?.state.currentGamePoints).toBe(3);
    expect(nextCourtSideFor(liveSets, "traditional")).toBe("AD");
  });
});

/** A minimal Match via createMatch — override just what a test cares about. */
function matchOf(
  scoringSystem: ScoringSystem = "traditional",
  outcomeOverride: MatchOutcomeOverride | null = null,
) {
  return createMatch(
    "2024-01-01",
    TRACKED_ID,
    { opponentId: OPPONENT_ID },
    TRACKED_ID,
    scoringSystem,
    "unspecified",
    outcomeOverride,
  );
}

describe("finalWinnerFor", () => {
  test.each(["retirement", "walkover", "default"] as const)(
    "%s override wins regardless of matchSets",
    (reason) => {
      const match = matchOf("traditional", { reason, winner: OPPONENT_ID });
      expect(finalWinnerFor(match, [])).toBe(OPPONENT_ID);
    },
  );

  test("no override, decided by sets, matches matchStateFor's own winner", () => {
    const match = matchOf("traditional");
    expect(finalWinnerFor(match, decidedMatchSets(2, 0))).toBe(TRACKED_ID);
  });

  test("no override, not yet decided -> null", () => {
    const match = matchOf("traditional");
    expect(finalWinnerFor(match, decidedMatchSets(1, 1))).toBeNull();
  });

  test("uses the match's own scoringSystem rules, not a hardcoded best-of-3 assumption", () => {
    const sets = decidedMatchSets(2, 1);
    // 2-1 decides a best-of-3 match but not a best-of-5 one.
    expect(finalWinnerFor(matchOf("traditional"), sets)).toBe(TRACKED_ID);
    expect(finalWinnerFor(matchOf("mens_grand_slam"), sets)).toBeNull();
  });
});

describe("scoreboardFor", () => {
  test("a brand-new match is love-all: one games column, one point column, both 0", () => {
    const scoreboard = scoreboardFor([], MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(scoreboard).toEqual({ trackedPlayer: ["0", "0"], opponent: ["0", "0"] });
  });

  test("a completed set plus a live game: one column per set, point call last", () => {
    const points = [
      ...completedGames(OPPONENT_ID, 4),
      ...completedGames(TRACKED_ID, 6), // set 1: 6-4 to the tracked player
      ...Array.from({ length: 2 }, () => pointWonBy(TRACKED_ID)), // 30-0 into set 2
    ];
    const scoreboard = scoreboardFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(scoreboard).toEqual({
      trackedPlayer: ["6", "0", "30"],
      opponent: ["4", "0", "0"],
    });
  });

  // Reach 6-6 without either side crossing the win threshold early — same safe
  // sequencing matchSetsFor's own tiebreak test uses: tracked's first 5 games
  // (5-0, under 6), then all 6 of the opponent's (5-6, only a 1-game lead), then
  // tracked's 6th (6-6, ties it and enters the breaker).
  const REACH_SIX_ALL = [
    ...completedGames(TRACKED_ID, 5),
    ...completedGames(OPPONENT_ID, 6),
    ...completedGames(TRACKED_ID, 1),
  ];

  test("a set decided by a tiebreak shows the games score plain — no brackets", () => {
    // Breaker: opponent's points first (0-5, safe — under the 7-point target), then
    // tracked's, crossing it only at the intended 7-5.
    const points = [
      ...REACH_SIX_ALL,
      ...Array.from({ length: 5 }, () => pointWonBy(OPPONENT_ID)),
      ...Array.from({ length: 7 }, () => pointWonBy(TRACKED_ID)),
    ];
    const scoreboard = scoreboardFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(scoreboard).toEqual({ trackedPlayer: ["7"], opponent: ["6"] });
  });

  test("mid-tiebreak: games column freezes at 6-6, final column is live breaker points", () => {
    const points = [...REACH_SIX_ALL, ...pointsFor(3, 2)];
    const scoreboard = scoreboardFor(points, MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(scoreboard).toEqual({ trackedPlayer: ["6", "3"], opponent: ["6", "2"] });
  });

  test("deuce and advantage are called, not just counted", () => {
    // Only the current set's own games column (0-0, nothing completed yet) precedes
    // the point call — no separate "set score" column when no set is finished.
    const deuce = scoreboardFor(pointsFor(3, 3), MATCH_ID, TRACKED_ID, OPPONENT_ID, "traditional");
    expect(deuce).toEqual({ trackedPlayer: ["0", "40"], opponent: ["0", "40"] });

    const advantage = scoreboardFor(
      [...pointsFor(3, 3), pointWonBy(TRACKED_ID)],
      MATCH_ID,
      TRACKED_ID,
      OPPONENT_ID,
      "traditional",
    );
    expect(advantage).toEqual({ trackedPlayer: ["0", "AD"], opponent: ["0", "40"] });
  });

  test("no-ad scoring never calls AD — 3-3 stays 40-40, sudden death from there", () => {
    const scoreboard = scoreboardFor(
      pointsFor(3, 3),
      MATCH_ID,
      TRACKED_ID,
      OPPONENT_ID,
      "no_ad_scoring",
    );
    expect(scoreboard).toEqual({ trackedPlayer: ["0", "40"], opponent: ["0", "40"] });
  });

  test("match_tiebreak_10_points' decider shows its breaker score bracketed once decided", () => {
    const points = [
      ...completedGames(TRACKED_ID, 6), // set 1: tracked 6-0
      ...completedGames(OPPONENT_ID, 6), // set 2: opponent 6-0
      // Decider: straight to the breaker at 0-0 — opponent's points first (0-7,
      // safe — under the 10-point target), then tracked's, crossing it at 10-7.
      ...Array.from({ length: 7 }, () => pointWonBy(OPPONENT_ID)),
      ...Array.from({ length: 10 }, () => pointWonBy(TRACKED_ID)),
    ];
    const scoreboard = scoreboardFor(
      points,
      MATCH_ID,
      TRACKED_ID,
      OPPONENT_ID,
      "match_tiebreak_10_points",
    );
    expect(scoreboard).toEqual({
      trackedPlayer: ["6", "0", "[10]"],
      opponent: ["0", "6", "[7]"],
    });
  });
});
