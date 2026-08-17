import { describe, expect, test } from "vitest";

import { Point } from "./point";
import { gameStateFor } from "./state";

const TRACKED_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";
const GAME_ID = "game-1";

/** A won point, minimal otherwise — override just the fields a test cares about. */
function pointWonBy(winner: string, overrides: Record<string, unknown> = {}) {
  return Point.create({
    id: `point-${crypto.randomUUID()}`,
    gameId: GAME_ID,
    trackedPlayerId: TRACKED_ID,
    opponentId: OPPONENT_ID,
    serveNumber: "first",
    outcome: winner === TRACKED_ID ? "win" : "loss",
    winner,
    server: TRACKED_ID,
    trackedPlayerShots: [],
    opponentShots: null,
    winBy: null,
    lossBy: null,
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
    test("rejects points from more than one game", () => {
      const points = [pointWonBy(TRACKED_ID), pointWonBy(TRACKED_ID, { gameId: "game-2" })];
      expect(() => gameStateFor(points, TRACKED_ID, OPPONENT_ID, true)).toThrow(/same gameId/);
    });

    test("rejects points that don't match the given participants", () => {
      // Internally consistent Point (winner/server are its own trackedPlayerId), just
      // for different participants than the ones passed to gameStateFor.
      const points = [
        pointWonBy("someone-else", {
          trackedPlayerId: "someone-else",
          server: "someone-else",
        }),
      ];
      expect(() => gameStateFor(points, TRACKED_ID, OPPONENT_ID, true)).toThrow(
        /match the given participants/,
      );
    });
  });
});
