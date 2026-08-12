/**
 * Live scoring domain model — Point.
 *
 * Point sits at the bottom of Point → Game → Set → Match. Only the tracked player's
 * shots are captured live; the opponent's shots are optional and may be filled in
 * later from video review, so `opponentShots` must distinguish "not recorded yet"
 * from "recorded, and there were none" (e.g. an ace).
 *
 * Singles only, for now: `PointParticipant` is a two-way discriminant rather than a
 * player id, because a `Match` only has one `Player` row (`player_id` on the backend)
 * — the opponent is free text (`opponent_name`), with no stable id to reference. See
 * `apps/api/src/matchpoint_api/models/match.py`.
 */

// --- Supporting enums -------------------------------------------------------
//
// Plain string-literal unions, each paired with a runtime array of its members —
// the array is what a hand-rolled validator checks incoming data against, since
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
// tag in one tap, not a full video-analysis shot taxonomy.
export type ShotType = "forehand" | "backhand" | "volley" | "overhead" | "drop_shot";
export const SHOT_TYPES: readonly ShotType[] = [
  "forehand",
  "backhand",
  "volley",
  "overhead",
  "drop_shot",
];

// Which side of the point — server or winner — a given role belongs to. Not a
// player id: see the module doc comment above.
export type PointParticipant = "tracked_player" | "opponent";
export const POINT_PARTICIPANTS: readonly PointParticipant[] = ["tracked_player", "opponent"];

// --- Shot --------------------------------------------------------------------

export interface Shot {
  type: ShotType;
}

function isShot(value: unknown): value is Shot {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    SHOT_TYPES.includes((value as { type: unknown }).type as ShotType)
  );
}

// --- Point ---------------------------------------------------------------------

// The persisted/wire shape — what actually round-trips through the Dexie outbox.
// `gameId` references the parent Game by id only, the same way the backend
// references `player_id` rather than embedding a row: Game doesn't exist as a
// class yet, and id references keep this serializable as a flat outbox record.
export interface PointData {
  id: string;
  gameId: string;
  serveNumber: ServeNumber;
  outcome: PointOutcome;
  winner: PointParticipant;
  server: PointParticipant;
  trackedPlayerShots: Shot[];
  // null = opponent's shots not recorded yet; [] = recorded, and there were none.
  opponentShots: Shot[] | null;
}

// TODO: this is a rough first pass at structural checks — revisit field-by-field
// once the outbox/sync layer settles on how untrusted this input really is.
function parsePointData(input: unknown): PointData {
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
  if (!SERVE_NUMBERS.includes(data.serveNumber as ServeNumber)) {
    throw new Error(`invalid serveNumber: ${String(data.serveNumber)}`);
  }
  if (!POINT_OUTCOMES.includes(data.outcome as PointOutcome)) {
    throw new Error(`invalid outcome: ${String(data.outcome)}`);
  }
  if (!POINT_PARTICIPANTS.includes(data.winner as PointParticipant)) {
    throw new Error(`invalid winner: ${String(data.winner)}`);
  }
  if (!POINT_PARTICIPANTS.includes(data.server as PointParticipant)) {
    throw new Error(`invalid server: ${String(data.server)}`);
  }
  if (!Array.isArray(data.trackedPlayerShots) || !data.trackedPlayerShots.every(isShot)) {
    throw new Error("trackedPlayerShots must be an array of shots");
  }
  if (
    data.opponentShots !== null &&
    (!Array.isArray(data.opponentShots) || !data.opponentShots.every(isShot))
  ) {
    throw new Error("opponentShots must be an array of shots, or null");
  }

  return data as unknown as PointData;
}

// TODO: flesh out beyond the one example rule the brief called out
// (DOUBLE_FAULT ⇒ no rally shots). Rough shape only.
function assertOutcomeConsistent(data: PointData): void {
  if (data.outcome === "ace" || data.outcome === "double_fault") {
    if (data.trackedPlayerShots.length > 0) {
      throw new Error(`${data.outcome} cannot have tracked-player rally shots`);
    }
    if ((data.opponentShots?.length ?? 0) > 0) {
      throw new Error(`${data.outcome} cannot have opponent rally shots`);
    }
  }

  // A double fault is by definition the server's own error on the second serve.
  if (data.outcome === "double_fault") {
    if (data.serveNumber !== "second") {
      throw new Error("double_fault must be on the second serve");
    }
    if (data.winner === data.server) {
      throw new Error("the server cannot win their own double fault");
    }
  }

  if (data.outcome === "ace" && data.winner !== data.server) {
    throw new Error("the server wins an ace");
  }
}

/**
 * Live scoring Point — an immutable wrapper around validated `PointData`.
 *
 * Construct via `Point.create()` (validates) or `Point.fromJSON()` (rehydrate from
 * the outbox); never `new Point(...)` directly, so a Point in memory is always
 * known-valid. `toJSON()` is what actually gets written to Dexie.
 */
export class Point {
  private constructor(private readonly data: PointData) {}

  static create(input: unknown): Point {
    const data = parsePointData(input);
    assertOutcomeConsistent(data);
    return new Point(data);
  }

  static fromJSON(json: unknown): Point {
    return Point.create(json);
  }

  toJSON(): PointData {
    return this.data;
  }

  get id(): string {
    return this.data.id;
  }

  get gameId(): string {
    return this.data.gameId;
  }

  get serveNumber(): ServeNumber {
    return this.data.serveNumber;
  }

  get outcome(): PointOutcome {
    return this.data.outcome;
  }

  get winner(): PointParticipant {
    return this.data.winner;
  }

  get server(): PointParticipant {
    return this.data.server;
  }

  get trackedPlayerShots(): readonly Shot[] {
    return this.data.trackedPlayerShots;
  }

  get opponentShots(): readonly Shot[] | null {
    return this.data.opponentShots;
  }

  get opponentDataComplete(): boolean {
    return this.data.opponentShots !== null;
  }

  /**
   * Derived, not stored. Undercounts while `opponentShots` is still null —
   * check `opponentDataComplete` before trusting this for stats that need the
   * full rally.
   */
  get rallyLength(): number {
    return this.data.trackedPlayerShots.length + (this.data.opponentShots?.length ?? 0);
  }
}
