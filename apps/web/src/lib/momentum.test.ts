import type { PointRead } from "@matchpoint/api-client";
import { expect, test } from "vitest";

import { blockHeight, deriveSets } from "./momentum";

// Same fixture shape as match-list.test.tsx's own `point()` helper. This
// module's tests were split out of that file's coverage of `MatchCard` once
// `deriveSets` became a shared, standalone function.
function point(overrides: Partial<PointRead> & Pick<PointRead, "game_number" | "won">): PointRead {
  return {
    id: `point-${overrides.game_number}-${Math.random()}`,
    match_id: "match-1",
    set_number: 1,
    sequence: 0,
    server: "tracked",
    in_tiebreak: false,
    is_break_point: false,
    is_game_end: false,
    is_game_point: false,
    is_match_point: false,
    is_set_end: false,
    is_set_point: false,
    ball_depth: null,
    ball_half: null,
    ball_in: null,
    ball_out_mode: null,
    end_reason: null,
    note: null,
    return_outcome: null,
    rally_length_bucket: null,
    court_side: "deuce",
    serve1_fault_mode: null,
    serve1_outcome: null,
    serve2_fault_mode: null,
    serve2_outcome: null,
    shot_type: null,
    unusual_reason: null,
    wing: null,
    ...overrides,
  };
}

function lovGameWonByTracked(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true }),
    point({ game_number: gameNumber, won: true, is_game_end: true }),
  ];
}

function gameWonByOpponent(gameNumber: number): PointRead[] {
  return [
    point({ game_number: gameNumber, won: false }),
    point({ game_number: gameNumber, won: false }),
    point({ game_number: gameNumber, won: false, is_game_end: true }),
  ];
}

test("derives a set's score and per-game winner from the raw point log", () => {
  const points = [...lovGameWonByTracked(1), ...gameWonByOpponent(2)];
  const [set] = deriveSets(points, false);

  expect(set!.setNumber).toBe(1);
  expect(set!.tracked).toBe(1);
  expect(set!.opponent).toBe(1);
  expect(set!.games.map((game) => game.winner)).toEqual(["tracked", "opponent"]);
});

test("collects a game's own notes only, in sequence order, oldest first", () => {
  const points = [
    ...lovGameWonByTracked(1).map((p, i) => ({ ...p, sequence: i })),
    ...gameWonByOpponent(2).map((p, i) => ({ ...p, sequence: 4 + i })),
  ];
  // Two notes land in game 1, one in game 2. Each game's own notes stay
  // separate rather than pooling across the whole set.
  points[0] = { ...points[0]!, note: "Rushing the net on short balls" };
  points[2] = { ...points[2]!, note: "Second serve toss too low" };
  points[4] = { ...points[4]!, note: "Tightening up on break points" };

  const [set] = deriveSets(points, false);
  const [game1, game2] = set!.games;

  expect(game1!.notes).toEqual(["Rushing the net on short balls", "Second serve toss too low"]);
  expect(game2!.notes).toEqual(["Tightening up on break points"]);
});

test("a game with no notes gets an empty array, not undefined or null", () => {
  const [set] = deriveSets(lovGameWonByTracked(1), false);
  expect(set!.games[0]!.notes).toEqual([]);
});

test("longRallyShare is the percentage of a game's bucketed points past 5 shots", () => {
  const points = lovGameWonByTracked(1).map((p, i) => {
    // b1/b2 are 5 shots or fewer, b3/b4 run past that. 2 of 4 points here
    // extend past 5 shots, so this game's share should land at 50%.
    if (i === 0) return { ...p, rally_length_bucket: "b1" as const };
    if (i === 1) return { ...p, rally_length_bucket: "b3" as const };
    if (i === 2) return { ...p, rally_length_bucket: "b4" as const };
    return { ...p, rally_length_bucket: "b2" as const };
  });

  const [set] = deriveSets(points, false);
  expect(set!.games[0]!.longRallyShare).toBe(50);
});

test("longRallyShare is null, not 0, when a game recorded no rally-length bucket at all", () => {
  const [set] = deriveSets(lovGameWonByTracked(1), false);
  expect(set!.games[0]!.longRallyShare).toBeNull();
});

test("blockHeight scales within the given max/min, defaulting to the small strip's own scale", () => {
  expect(blockHeight(4)).toBe(20); // shortest game -> tallest bar, default scale
  expect(blockHeight(12)).toBe(8); // longest game -> shortest bar, default scale
  expect(blockHeight(4, 40, 16)).toBe(40); // same curve, a caller-supplied larger scale
  expect(blockHeight(12, 40, 16)).toBe(16);
});
