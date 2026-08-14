/**
 * Live scoring domain model — Match.
 *
 * Sits at the top of Point → Game → Set → Match. `scoringRules` is decided once
 * here and is meant to be threaded down unchanged through Set and Game, the same
 * way `trackedPlayerId`/`opponentId` are set once at Match and passed down through
 * every Point (see `point.ts`) — so no level below Match ever redecides the
 * match's format.
 */

// --- Supporting enums -------------------------------------------------------
//
// Same convention as point.ts: plain string-literal unions, each paired with a
// runtime array of its members for validating untrusted input.

export type FirstServer = "player" | "opponent";
export const FIRST_SERVERS: readonly FirstServer[] = ["player", "opponent"];

// TODO: provisional — revisit once we know which surfaces coaches actually track.
export type SurfaceType = "hard" | "clay" | "grass" | "carpet";
export const SURFACE_TYPES: readonly SurfaceType[] = ["hard", "clay", "grass", "carpet"];

// TODO: fields TBD (ad scoring, tiebreak-at, final-set format, sets-to-win, ...).
// Whatever lands here is fixed for the whole match — Match decides it once, Set
// and Game only ever read it, never redefine it (see module doc comment above).
export interface ScoringRules {}

/**
 * `id` and `trackedPlayerId`/`opponentId` follow Point's convention: `trackedPlayerId`
 * always comes from a real `Player` row, `opponentId` does too when the opponent is
 * identifiable, and stands in for the backend's free-text `Match.opponent_name`
 * otherwise (see `point.ts` and `apps/api/src/matchpoint_api/models/match.py`).
 */
export class Match {
  readonly id: string;
  // ISO 8601 — year, month, day and time the match was played.
  readonly timestamp: string;
  readonly trackedPlayerId: string;
  readonly opponentId: string;
  readonly scoringRules: ScoringRules;
  readonly firstServer: FirstServer;
  readonly surfaceType: SurfaceType;

  private constructor(fields: {
    id: string;
    timestamp: string;
    trackedPlayerId: string;
    opponentId: string;
    scoringRules: ScoringRules;
    firstServer: FirstServer;
    surfaceType: SurfaceType;
  }) {
    this.id = fields.id;
    this.timestamp = fields.timestamp;
    this.trackedPlayerId = fields.trackedPlayerId;
    this.opponentId = fields.opponentId;
    this.scoringRules = fields.scoringRules;
    this.firstServer = fields.firstServer;
    this.surfaceType = fields.surfaceType;
  }

  // TODO: rough first pass at structural checks, matching Point.create's approach —
  // revisit once ScoringRules has real fields to validate and the outbox/sync layer
  // settles on how untrusted this input really is.
  static create(input: unknown): Match {
    if (typeof input !== "object" || input === null) {
      throw new Error("match data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new Error("match id must be a non-empty string");
    }
    if (typeof data.timestamp !== "string" || Number.isNaN(Date.parse(data.timestamp))) {
      throw new Error("match timestamp must be a valid ISO 8601 date-time string");
    }
    if (typeof data.trackedPlayerId !== "string" || data.trackedPlayerId.length === 0) {
      throw new Error("trackedPlayerId must be a non-empty string");
    }
    if (typeof data.opponentId !== "string" || data.opponentId.length === 0) {
      throw new Error("opponentId must be a non-empty string");
    }
    if (data.trackedPlayerId === data.opponentId) {
      throw new Error("trackedPlayerId and opponentId must be different");
    }
    if (typeof data.scoringRules !== "object" || data.scoringRules === null) {
      throw new Error("scoringRules must be an object");
    }
    if (!FIRST_SERVERS.includes(data.firstServer as FirstServer)) {
      throw new Error(`invalid firstServer: ${String(data.firstServer)}`);
    }
    if (!SURFACE_TYPES.includes(data.surfaceType as SurfaceType)) {
      throw new Error(`invalid surfaceType: ${String(data.surfaceType)}`);
    }

    return new Match({
      id: data.id,
      timestamp: data.timestamp,
      trackedPlayerId: data.trackedPlayerId,
      opponentId: data.opponentId,
      scoringRules: data.scoringRules as ScoringRules,
      firstServer: data.firstServer as FirstServer,
      surfaceType: data.surfaceType as SurfaceType,
    });
  }
}
