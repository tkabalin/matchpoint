import { zScoreCheckpointCreate } from "@matchpoint/api-client/zod";
import { describe, expect, test } from "vitest";

import { ScoreCheckpoint } from "@/features/capture/checkpoint";
import { createMatch } from "@/features/capture/match";
import type { ScoreSnapshot } from "@/features/capture/score";

import { toScoreCheckpointCreate } from "./checkpoint-payload";

const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000011";
const PLAYER_ID = "3f1c2b4e-0000-4000-8000-000000000001";
const OPPONENT_ID = "3f1c2b4e-0000-4000-8000-000000000002";

// Traditional scoring, ad-scored best of 3, the tracked player serving first —
// what createMatch defaults to.
const MATCH = createMatch(
  "2026-08-15",
  PLAYER_ID,
  { opponentId: OPPONENT_ID },
  PLAYER_ID,
  "traditional",
);

function checkpoint(overrides: {
  after: ScoreSnapshot;
  servesNext?: "TRACKED" | "OPPONENT";
  orderChanged?: boolean;
}): ScoreCheckpoint {
  return ScoreCheckpoint.create({
    id: "3f1c2b4e-0000-4000-8000-000000000030",
    matchId: MATCH_ID,
    timestamp: 1_755_600_000_000,
    sequence: 4,
    servesNext: "TRACKED",
    orderChanged: false,
    ...overrides,
  });
}

describe("toScoreCheckpointCreate", () => {
  test("produces a body the API's own contract accepts", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({ after: { sets: [{ tracked: 2, opponent: 1, tiebreak: null }], game: null } }),
    );
    expect(() => zScoreCheckpointCreate.parse(body)).not.toThrow();
  });

  test("sends the id, sequence and lowered enums the checkpoint was recorded with", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({
        after: { sets: [{ tracked: 0, opponent: 0, tiebreak: null }], game: null },
        servesNext: "OPPONENT",
        orderChanged: true,
      }),
    );
    expect(body.id).toBe("3f1c2b4e-0000-4000-8000-000000000030");
    expect(body.sequence).toBe(4);
    expect(body.serves_next).toBe("opponent");
    expect(body.order_changed).toBe(true);
  });

  // A set still in progress has no winner yet — the trailing entry snapshotOf
  // (score.ts) itself would build from the same board.
  test("leaves the set in progress without a winner", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({ after: { sets: [{ tracked: 3, opponent: 2, tiebreak: null }], game: null } }),
    );
    expect(body.after.sets).toEqual([
      {
        set_number: 1,
        games_tracked: 3,
        games_opponent: 2,
        tiebreak_tracked: null,
        tiebreak_opponent: null,
        winner: null,
      },
    ]);
  });

  // Games alone decide 6-4, no tiebreak: the tracked player is credited the win
  // and the checkpoint opens a fresh set at love-all, exactly what score.ts's
  // own "complete last set that doesn't decide the match" normalisation does.
  test("credits a completed set's winner and opens the next set", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({
        after: {
          sets: [
            { tracked: 6, opponent: 4, tiebreak: null },
            { tracked: 1, opponent: 0, tiebreak: null },
          ],
          game: null,
        },
      }),
    );
    expect(body.after.sets).toEqual([
      expect.objectContaining({ set_number: 1, winner: "tracked" }),
      expect.objectContaining({ set_number: 2, winner: null }),
    ]);
  });

  // Two sets decide a best-of-3: no set is left in progress, so there's no
  // trailing null-winner entry — every set in `after` has a winner.
  test("carries no trailing set once the match is decided", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({
        after: {
          sets: [
            { tracked: 6, opponent: 4, tiebreak: null },
            { tracked: 6, opponent: 3, tiebreak: null },
          ],
          game: null,
        },
      }),
    );
    expect(body.after.sets).toHaveLength(2);
    expect(body.after.sets.every((set) => set.winner !== null)).toBe(true);
  });

  test("carries a completed set's breaker score", () => {
    const body = toScoreCheckpointCreate(
      MATCH,
      checkpoint({
        after: {
          sets: [{ tracked: 7, opponent: 6, tiebreak: { tracked: 7, opponent: 5 } }],
          game: null,
        },
      }),
    );
    expect(body.after.sets[0]).toMatchObject({
      games_tracked: 7,
      games_opponent: 6,
      tiebreak_tracked: 7,
      tiebreak_opponent: 5,
      winner: "tracked",
    });
  });

  test("throws on a snapshot that does not interpret against its match", () => {
    // Traditional is best of 3; a fourth set is not a legal snapshot for it.
    const after: ScoreSnapshot = {
      sets: [
        { tracked: 6, opponent: 4, tiebreak: null },
        { tracked: 6, opponent: 3, tiebreak: null },
        { tracked: 6, opponent: 2, tiebreak: null },
        { tracked: 6, opponent: 1, tiebreak: null },
      ],
      game: null,
    };
    expect(() => toScoreCheckpointCreate(MATCH, checkpoint({ after }))).toThrow();
  });
});
