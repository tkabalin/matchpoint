/**
 * Live scoring domain model — Point.
 *
 * Point sits at the bottom of Point → Game → Set → Match. Only the tracked player's
 * shots are captured live; the opponent's shots are optional and may only ever
 * arrive later — e.g. if the opponent's own coach also tracks them and shares that
 * match — so `opponentShots` must distinguish "not recorded yet" from "recorded, and
 * there were none" (e.g. an ace).
 *
 * Singles only, for now. `trackedPlayerId` and `opponentId` are set once at Match
 * level and passed down through Set/Game to every Point, so `winner`/`server` can be
 * plain id references instead of a role discriminant. `trackedPlayerId` always comes
 * from a real `Player` row; `opponentId` does too when the opponent is identifiable,
 * but the backend's `Match.opponent_name` is often free text with no `Player` behind
 * it (see `apps/api/src/matchpoint_api/models/match.py`) — when that's the case,
 * Match assigns a default per-match id standing in for "the opponent", so every
 * Point still gets two real ids to validate and compare `winner`/`server` against.
 */

// --- Supporting enums -------------------------------------------------------
//
// Plain string-literal unions, each paired with a runtime array of its members —
// the array is what Point's validation checks incoming data against, since
// TypeScript's own type-checking disappears at runtime (e.g. data read back out of
// the Dexie outbox).

export type ServeNumber = "first" | "second";
export const SERVE_NUMBERS: readonly ServeNumber[] = ["first", "second"];

export type PointOutcome = "ace" | "winner" | "unforced_error" | "forced_error" | "double_fault";
export const POINT_OUTCOMES: readonly PointOutcome[] = [
  "ace",
  "winner",
  "unforced_error",
  "forced_error",
  "double_fault",
];

// TODO: revisit once the capture UI is built — keep this to whatever a coach can
// tag in one tap, not a granular shot taxonomy.
export type ShotType = "forehand" | "backhand" | "volley" | "overhead" | "drop_shot";
export const SHOT_TYPES: readonly ShotType[] = [
  "forehand",
  "backhand",
  "volley",
  "overhead",
  "drop_shot",
];

function isShotType(value: unknown): value is ShotType {
  return SHOT_TYPES.includes(value as ShotType);
}

// --- Point ---------------------------------------------------------------------

// TODO: flesh out beyond the one example rule the brief called out
// (DOUBLE_FAULT ⇒ no rally shots). Rough shape only.
function assertOutcomeConsistent(fields: {
  outcome: PointOutcome;
  serveNumber: ServeNumber;
  winner: string;
  server: string;
  trackedPlayerShots: ShotType[];
  opponentShots: ShotType[] | null;
}): void {
  if (fields.outcome === "ace" || fields.outcome === "double_fault") {
    if (fields.trackedPlayerShots.length > 0) {
      throw new Error(`${fields.outcome} cannot have tracked-player rally shots`);
    }
    if ((fields.opponentShots?.length ?? 0) > 0) {
      throw new Error(`${fields.outcome} cannot have opponent rally shots`);
    }
  }

  // A double fault is by definition the server's own error on the second serve.
  if (fields.outcome === "double_fault") {
    if (fields.serveNumber !== "second") {
      throw new Error("double_fault must be on the second serve");
    }
    if (fields.winner === fields.server) {
      throw new Error("the server cannot win their own double fault");
    }
  }

  if (fields.outcome === "ace" && fields.winner !== fields.server) {
    throw new Error("the server wins an ace");
  }
}

/**
 * Live scoring Point.
 *
 * Construct via `Point.create()` (validates) or `Point.fromJSON()` (rehydrate from
 * the outbox); never `new Point(...)` directly, so a Point in memory is always
 * known-valid. `toJSON()` is what actually gets written to Dexie.
 *
 * `gameId` references the parent Game by id only, the same way the backend
 * references `player_id` rather than embedding a row: Game doesn't exist as a class
 * yet, and id references keep this serializable as a flat outbox record.
 */
export class Point {
  readonly id: string;
  readonly gameId: string;
  // Both set once at Match level and passed down unchanged through every Point in
  // the match — see the module doc comment for why opponentId is always present
  // even when the opponent isn't a real Player row.
  readonly trackedPlayerId: string;
  readonly opponentId: string;
  readonly serveNumber: ServeNumber;
  readonly outcome: PointOutcome;
  // Must equal trackedPlayerId or opponentId — checked in Point.create.
  readonly winner: string;
  readonly server: string;
  readonly trackedPlayerShots: ShotType[];
  // null = opponent's shots not recorded yet; [] = recorded, and there were none.
  readonly opponentShots: ShotType[] | null;

  private constructor(fields: {
    id: string;
    gameId: string;
    trackedPlayerId: string;
    opponentId: string;
    serveNumber: ServeNumber;
    outcome: PointOutcome;
    winner: string;
    server: string;
    trackedPlayerShots: ShotType[];
    opponentShots: ShotType[] | null;
  }) {
    this.id = fields.id;
    this.gameId = fields.gameId;
    this.trackedPlayerId = fields.trackedPlayerId;
    this.opponentId = fields.opponentId;
    this.serveNumber = fields.serveNumber;
    this.outcome = fields.outcome;
    this.winner = fields.winner;
    this.server = fields.server;
    this.trackedPlayerShots = fields.trackedPlayerShots;
    this.opponentShots = fields.opponentShots;
  }

  // TODO: this is a rough first pass at structural checks — revisit field-by-field
  // once the outbox/sync layer settles on how untrusted this input really is.
  static create(input: unknown): Point {
    if (typeof input !== "object" || input === null) {
      throw new Error("point data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new Error("point id must be a non-empty string");
    }
    if (typeof data.gameId !== "string" || data.gameId.length === 0) {
      throw new Error("point gameId must be a non-empty string");
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
    if (!SERVE_NUMBERS.includes(data.serveNumber as ServeNumber)) {
      throw new Error(`invalid serveNumber: ${String(data.serveNumber)}`);
    }
    if (!POINT_OUTCOMES.includes(data.outcome as PointOutcome)) {
      throw new Error(`invalid outcome: ${String(data.outcome)}`);
    }
    const participants = [data.trackedPlayerId, data.opponentId];
    if (!participants.includes(data.winner as string)) {
      throw new Error(`winner must be trackedPlayerId or opponentId, got: ${String(data.winner)}`);
    }
    if (!participants.includes(data.server as string)) {
      throw new Error(`server must be trackedPlayerId or opponentId, got: ${String(data.server)}`);
    }
    if (!Array.isArray(data.trackedPlayerShots) || !data.trackedPlayerShots.every(isShotType)) {
      throw new Error("trackedPlayerShots must be an array of shot types");
    }
    const trackedPlayerShots = data.trackedPlayerShots as ShotType[];

    let opponentShots: ShotType[] | null = null;
    if (data.opponentShots !== null) {
      if (!Array.isArray(data.opponentShots) || !data.opponentShots.every(isShotType)) {
        throw new Error("opponentShots must be an array of shot types, or null");
      }
      opponentShots = data.opponentShots;
    }

    const fields = {
      id: data.id,
      gameId: data.gameId,
      trackedPlayerId: data.trackedPlayerId,
      opponentId: data.opponentId,
      serveNumber: data.serveNumber as ServeNumber,
      outcome: data.outcome as PointOutcome,
      winner: data.winner as string,
      server: data.server as string,
      trackedPlayerShots,
      opponentShots,
    };
    assertOutcomeConsistent(fields);
    return new Point(fields);
  }

  static fromJSON(json: unknown): Point {
    return Point.create(json);
  }

  toJSON() {
    return {
      id: this.id,
      gameId: this.gameId,
      trackedPlayerId: this.trackedPlayerId,
      opponentId: this.opponentId,
      serveNumber: this.serveNumber,
      outcome: this.outcome,
      winner: this.winner,
      server: this.server,
      trackedPlayerShots: this.trackedPlayerShots,
      opponentShots: this.opponentShots,
    };
  }

  get opponentDataComplete(): boolean {
    return this.opponentShots !== null;
  }

  /**
   * Derived, not stored. Undercounts while `opponentShots` is still null —
   * check `opponentDataComplete` before trusting this for stats that need the
   * full rally.
   */
  get rallyLength(): number {
    return this.trackedPlayerShots.length + (this.opponentShots?.length ?? 0);
  }
}
