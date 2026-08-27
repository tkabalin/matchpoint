/**
 * The boundary between the capture domain model and the API for points, the
 * sibling of match-payload.ts. Still not implementable: the capture model now carries
 * the nine score-context stamps (see point.ts's PointContext), but a Point's
 * observation fields are nullable and PointCreate's serve1_outcome/end_reason are not,
 * so a point whose serve or ending went unwatched has nothing to map to until the API
 * takes those columns nullable. Until then this throws and the drain parks the batch as
 * unmappable. drain.test.ts mocks this module out entirely to test the engine against a
 * stand-in, so this file's own throw is covered by point-payload.test.ts alone.
 */

import type { PointCreate } from "@matchpoint/api-client";

import type { Point } from "@/features/capture/point";

export function toPointCreate(point: Point): PointCreate {
  throw new Error(
    `point ${point.id} cannot be mapped: the API cannot yet store an unwatched serve or ending`,
  );
}
