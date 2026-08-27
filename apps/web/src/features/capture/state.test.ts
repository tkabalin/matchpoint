import { describe, expect, test } from "vitest";

import { createMatch } from "./match";
import type { MatchOutcomeOverride, ScoringSystem } from "./match";
import { MatchSet } from "./match-set";
import {
  finalWinnerFor,
  isAdScoringFor,
  matchRulesFor,
  matchStateFor,
  maxSetsFor,
  setRulesFor,
} from "./state";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const MATCH_ID = "4f1c2b4e-0000-4000-8000-000000000003";

describe("maxSetsFor", () => {
  test.each([
    ["traditional", 3],
    ["mens_grand_slam", 5],
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
});

describe("isAdScoringFor", () => {
  test.each([
    ["traditional", true],
    ["mens_grand_slam", true],
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
