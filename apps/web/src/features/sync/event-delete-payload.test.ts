import { describe, expect, test } from "vitest";

import type { OutboxRow } from "@/features/outbox/db";

import { toEventDeleteTarget } from "./event-delete-payload";

const TARGET_ID = "3f1c2b4e-0000-4000-8000-000000000040";

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: `${TARGET_ID}:delete`,
    coachId: "c0ac0000-0000-4000-8000-000000000001",
    matchId: "3f1c2b4e-0000-4000-8000-000000000011",
    kind: "eventDelete",
    payload: { kind: "point" },
    seq: 1,
    status: "pending",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("toEventDeleteTarget", () => {
  test("recovers the target id from the row's own id", () => {
    expect(toEventDeleteTarget(row())).toEqual({ kind: "point", targetId: TARGET_ID });
  });

  test("reads a checkpoint delete the same way", () => {
    expect(toEventDeleteTarget(row({ payload: { kind: "checkpoint" } }))).toEqual({
      kind: "checkpoint",
      targetId: TARGET_ID,
    });
  });

  test.each([
    ["not an object", "nonsense"],
    ["null", null],
    ["an invalid kind", { kind: "match" }],
    ["missing kind", {}],
  ])("rejects a payload that is %s", (_label, payload) => {
    expect(() => toEventDeleteTarget(row({ payload }))).toThrow();
  });

  test("rejects a row id missing the :delete suffix", () => {
    expect(() => toEventDeleteTarget(row({ id: TARGET_ID }))).toThrow();
  });
});
