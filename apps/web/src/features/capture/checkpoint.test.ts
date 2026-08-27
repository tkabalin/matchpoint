import { describe, expect, test } from "vitest";

import { ScoreCheckpoint } from "./checkpoint";

/** A minimal, valid raw checkpoint payload — override just what a test cares about. */
function checkpointData(overrides: Record<string, unknown> = {}) {
  return {
    id: "checkpoint-1",
    matchId: "match-1",
    timestamp: 1_700_000_000_000,
    sequence: 3,
    after: {
      sets: [
        { tracked: 6, opponent: 3, tiebreak: null },
        { tracked: 2, opponent: 1, tiebreak: null },
      ],
      game: { tracked: 1, opponent: 0 },
    },
    servesNext: "TRACKED",
    orderChanged: false,
    ...overrides,
  };
}

describe("ScoreCheckpoint.create", () => {
  test("accepts a well-formed checkpoint", () => {
    const checkpoint = ScoreCheckpoint.create(checkpointData());
    expect(checkpoint.sequence).toBe(3);
    expect(checkpoint.after.sets).toHaveLength(2);
    expect(checkpoint.after.game).toEqual({ tracked: 1, opponent: 0 });
    expect(checkpoint.orderChanged).toBe(false);
  });

  test.each(["id", "matchId"])("rejects a missing %s", (field) => {
    expect(() => ScoreCheckpoint.create(checkpointData({ [field]: "" }))).toThrow(
      new RegExp(field),
    );
  });

  test("rejects a negative or fractional sequence", () => {
    expect(() => ScoreCheckpoint.create(checkpointData({ sequence: -1 }))).toThrow(/sequence/);
    expect(() => ScoreCheckpoint.create(checkpointData({ sequence: 1.5 }))).toThrow(/sequence/);
  });

  test("rejects an unknown servesNext", () => {
    expect(() => ScoreCheckpoint.create(checkpointData({ servesNext: "EITHER" }))).toThrow(
      /servesNext/,
    );
  });

  test("rejects a non-boolean orderChanged", () => {
    expect(() => ScoreCheckpoint.create(checkpointData({ orderChanged: "yes" }))).toThrow(
      /orderChanged/,
    );
  });

  test("requires at least one set", () => {
    expect(() =>
      ScoreCheckpoint.create(checkpointData({ after: { sets: [], game: null } })),
    ).toThrow(/sets/);
  });

  test("rejects a set score that isn't two whole numbers", () => {
    expect(() =>
      ScoreCheckpoint.create(
        checkpointData({
          after: { sets: [{ tracked: 6, opponent: -1, tiebreak: null }], game: null },
        }),
      ),
    ).toThrow(/non-negative/);
  });

  test("accepts a breaker score, and a set with none", () => {
    const checkpoint = ScoreCheckpoint.create(
      checkpointData({
        after: {
          sets: [{ tracked: 6, opponent: 6, tiebreak: { tracked: 3, opponent: 2 } }],
          game: null,
        },
      }),
    );
    expect(checkpoint.after.sets[0]?.tiebreak).toEqual({ tracked: 3, opponent: 2 });
    expect(checkpoint.after.game).toBeNull();
  });

  // Whether a score is legal tennis is score.ts's question, not this class's: the same
  // split Point.create keeps between shape and tennis-logic coherence.
  test("does not check whether the score is reachable", () => {
    expect(() =>
      ScoreCheckpoint.create(
        checkpointData({
          after: { sets: [{ tracked: 7, opponent: 4, tiebreak: null }], game: null },
        }),
      ),
    ).not.toThrow();
  });

  test("round-trips through toJSON, copying the snapshot rather than sharing it", () => {
    const checkpoint = ScoreCheckpoint.create(checkpointData());
    const json = checkpoint.toJSON();
    json.after.sets[0]!.tracked = 99;
    expect(checkpoint.after.sets[0]?.tracked).toBe(6);
    expect(ScoreCheckpoint.fromJSON(checkpoint.toJSON()).after).toEqual(checkpoint.after);
  });
});
