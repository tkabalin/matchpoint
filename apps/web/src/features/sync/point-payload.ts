/**
 * The boundary between the capture domain model and the API for points, the
 * sibling of match-payload.ts. `Point` is shaped for scoring and `PointCreate` for
 * storage, so the two differ in more than case: a serve is an array of attempts here
 * and six flat columns there, and a final ball is one `ballLocation` here and four
 * columns there. Annotating the return type is what makes a backend field change a
 * compile error in this app: see "Contract checks against the API" in docs/testing.md.
 *
 * Every enum member on the wire is the capture member lowercased, which is what lets
 * one helper carry them all and still be checked: `Lowercase<"DOUBLE_FAULT">` is the
 * literal "double_fault", so a member the API lacks fails to type against PointCreate.
 */

import type { PointCreate } from "@matchpoint/api-client";

import { NOTE_MAX_LENGTH, type Point, type ServeAttempt } from "@/features/capture/point";

function lower<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

function lowerOrNull<T extends string>(value: T | null): Lowercase<T> | null {
  return value === null ? null : lower(value);
}

/**
 * One attempt's three columns. A serve that landed records the box it was aimed at,
 * which is the side the point was played from (see ServeAttempt.location); a fault
 * records how it missed; an opponent's serve records neither, and an attempt nobody
 * watched is absent from `serves` and so null throughout.
 */
function serveColumns(attempt: ServeAttempt | undefined, point: Point) {
  if (attempt === undefined) return { outcome: null, box: null, faultMode: null };
  if (point.server === "OPPONENT") {
    return { outcome: lower(attempt.outcome), box: null, faultMode: null };
  }
  if (attempt.outcome === "FAULT") {
    return { outcome: lower(attempt.outcome), box: null, faultMode: lowerOrNull(attempt.location) };
  }
  return { outcome: lower(attempt.outcome), box: lower(point.courtSide), faultMode: null };
}

/**
 * The API has one note column and the capture model two, so an unusual point's own
 * note rides below the general one. Bounded again because the join can exceed what
 * each half was bounded to alone, and a 422 would park the whole batch.
 */
function noteColumn(point: Point): string | null {
  const parts = [point.note, point.unusualNote].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return parts.join("\n").slice(0, NOTE_MAX_LENGTH);
}

export function toPointCreate(point: Point): PointCreate {
  const first = serveColumns(point.serves[0], point);
  const second = serveColumns(point.serves[1], point);
  // ballLocation is a CourtZone when the ball stayed in and a FailureMode when it
  // did not; Point.create has already tied each shape to its ballIn value.
  const zone = typeof point.ballLocation === "object" ? point.ballLocation : null;
  const outMode = typeof point.ballLocation === "string" ? point.ballLocation : null;
  return {
    // The id minted on the device, sent so a batch replayed after a dropped response
    // lands on the points already stored instead of writing them twice (#107).
    id: point.id,
    sequence: point.sequence,
    server: lower(point.server),
    won: point.won,
    serve1_outcome: first.outcome,
    serve1_box: first.box,
    serve1_fault_mode: first.faultMode,
    serve2_outcome: second.outcome,
    serve2_box: second.box,
    serve2_fault_mode: second.faultMode,
    return_outcome: lowerOrNull(point.returnOutcome),
    end_reason: lowerOrNull(point.endReason),
    unusual_reason: lowerOrNull(point.unusualReason),
    note: noteColumn(point),
    wing: lowerOrNull(point.wing),
    shot_type: lowerOrNull(point.shotType),
    ball_in: point.ballIn,
    ball_half: zone === null ? null : lower(zone.half),
    ball_depth: zone === null ? null : lower(zone.depth),
    ball_out_mode: lowerOrNull(outMode),
    rally_length_bucket: lowerOrNull(point.rallyLengthBucket),
    set_number: point.context.setNumber,
    game_number: point.context.gameNumber,
    in_tiebreak: point.context.inTiebreak,
    is_break_point: point.context.isBreakPoint,
    is_game_point: point.context.isGamePoint,
    is_game_end: point.context.isGameEnd,
    is_set_point: point.context.isSetPoint,
    is_set_end: point.context.isSetEnd,
    is_match_point: point.context.isMatchPoint,
  };
}
