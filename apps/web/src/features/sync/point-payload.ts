/**
 * The boundary between the capture domain model and the API for points, the
 * sibling of match-payload.ts. Not implementable yet: PointCreate requires the
 * nine score-context stamps (set_number, is_break_point, ...) that the capture
 * model only gains with #210, so until that lands this throws and the drain
 * parks the batch as unmappable. Nothing appends point rows in production yet;
 * drain.test.ts mocks this module out entirely to test the engine against a
 * stand-in, so this file's own throw is covered by point-payload.test.ts alone.
 */

import type { PointCreate } from "@matchpoint/api-client";

import type { Point } from "@/features/capture/point";

export function toPointCreate(point: Point): PointCreate {
  throw new Error(
    `point ${point.id} cannot be mapped: the capture model does not carry the score stamps yet`,
  );
}
