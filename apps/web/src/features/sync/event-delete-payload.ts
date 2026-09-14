/**
 * The boundary between an `eventDelete` outbox row and the API's point/checkpoint
 * delete calls. `undo()` (live-match.tsx) queues the row under its own id,
 * `` `${removed.id}:delete` ``, with `{ kind }` as its payload — the target id isn't
 * repeated in the payload, so it's recovered here by stripping the row's own fixed
 * suffix. Safe because every id undo ever deletes is a `crypto.randomUUID()`, which
 * never contains a colon.
 */

import type { OutboxRow } from "@/features/outbox/db";

const SUFFIX = ":delete";

export interface EventDeleteTarget {
  kind: "point" | "checkpoint";
  targetId: string;
}

export function toEventDeleteTarget(row: OutboxRow): EventDeleteTarget {
  if (typeof row.payload !== "object" || row.payload === null) {
    throw new Error("eventDelete payload must be an object");
  }
  const { kind } = row.payload as Record<string, unknown>;
  if (kind !== "point" && kind !== "checkpoint") {
    throw new Error(`invalid eventDelete kind: ${String(kind)}`);
  }
  if (!row.id.endsWith(SUFFIX)) {
    throw new Error(`eventDelete row id is missing its "${SUFFIX}" suffix: ${row.id}`);
  }
  return { kind, targetId: row.id.slice(0, -SUFFIX.length) };
}
