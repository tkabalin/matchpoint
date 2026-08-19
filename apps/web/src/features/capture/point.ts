/**
 * Live scoring domain model — Point.
 *
 * Every point is recorded from the tracked player's point of view: `won` is the tracked
 * player's win/loss and `server` is a role ("TRACKED" | "OPPONENT"), not an id — so unlike
 * the model this replaces, a Point stores no `gameId` or `trackedPlayerId`/`opponentId`;
 * game membership is derived from `sequence` (see `state.ts`), and `server`/`won` alone
 * make a Point self-describing. Construct via `Point.create()`/`Point.fromJSON()`, never
 * `new Point(...)` — `create()` validates shape only (enum membership, nullness pairing by
 * `endReason`), not tennis-logic coherence, which is the capture UI's job once it exists.
 */

// --- Supporting enums -------------------------------------------------------
//
// Plain string-literal unions, each paired with a runtime array of its members —
// the array is what Point's validation checks incoming data against, since
// TypeScript's own type-checking disappears at runtime (e.g. data read back out of
// the Dexie outbox).

export type Server = "TRACKED" | "OPPONENT";
export const SERVERS: readonly Server[] = ["TRACKED", "OPPONENT"];

export type ReturnOutcome = "IN" | "ERROR_NET" | "ERROR_OUT";
export const RETURN_OUTCOMES: readonly ReturnOutcome[] = ["IN", "ERROR_NET", "ERROR_OUT"];

// FORCED covers what standard tennis calls a winner as well as a classic forced error —
// the ball was unreachable either way. MISTAKE is a reachable ball missed anyway. The
// line is drawn at reachability, not at racket contact.
export type EndReason = "FORCED" | "MISTAKE" | "ACE" | "DOUBLE_FAULT" | "UNUSUAL";
export const END_REASONS: readonly EndReason[] = [
  "FORCED",
  "MISTAKE",
  "ACE",
  "DOUBLE_FAULT",
  "UNUSUAL",
];

export type UnusualReason =
  | "NET_TOUCH"
  | "BALL_HIT_PLAYER"
  | "REACHED_OVER"
  | "DOUBLE_HIT"
  | "HINDRANCE"
  | "POINT_PENALTY"
  | "OTHER";
export const UNUSUAL_REASONS: readonly UnusualReason[] = [
  "NET_TOUCH",
  "BALL_HIT_PLAYER",
  "REACHED_OVER",
  "DOUBLE_HIT",
  "HINDRANCE",
  "POINT_PENALTY",
  "OTHER",
];

export type Wing = "FOREHAND" | "BACKHAND";
export const WINGS: readonly Wing[] = ["FOREHAND", "BACKHAND"];

// Smash and slice are deliberately excluded — smash has no meaningful wing, and slice
// folds into drive. Overheads are logged as volleys (both struck before the bounce).
export type ShotType = "DRIVE" | "VOLLEY" | "DROPSHOT" | "LOB";
export const SHOT_TYPES: readonly ShotType[] = ["DRIVE", "VOLLEY", "DROPSHOT", "LOB"];

export type ServeOutcome = "IN" | "FAULT" | "ACE";
export const SERVE_OUTCOMES: readonly ServeOutcome[] = ["IN", "FAULT", "ACE"];

// Shared by ServeZone.box and CourtZone.half — the same two physical sides of the court.
export type CourtSide = "DEUCE" | "AD";
export const COURT_SIDES: readonly CourtSide[] = ["DEUCE", "AD"];

export type ServeTarget = "WIDE" | "BODY" | "T";
export const SERVE_TARGETS: readonly ServeTarget[] = ["WIDE", "BODY", "T"];

export type FailureMode = "NET" | "LONG" | "WIDE";
export const FAILURE_MODES: readonly FailureMode[] = ["NET", "LONG", "WIDE"];

export type CourtDepth = "SHORT" | "MID" | "DEEP";
export const COURT_DEPTHS: readonly CourtDepth[] = ["SHORT", "MID", "DEEP"];

export type RallyBucket = "B1" | "B2" | "B3" | "B4";
export const RALLY_BUCKETS: readonly RallyBucket[] = ["B1", "B2", "B3", "B4"];

// --- Compound types ----------------------------------------------------------------

// Three zones per box, not raw coordinates — a coach watching live cannot place a
// coordinate reliably, and wide/body/T is how coaches already think about serve targets.
export interface ServeZone {
  box: CourtSide;
  target: ServeTarget;
}

// Where the last ball to land, landed — six zones, the same granularity as ServeZone.
export interface CourtZone {
  half: CourtSide;
  depth: CourtDepth;
}

export interface ServeAttempt {
  number: 1 | 2;
  outcome: ServeOutcome;
  // null when server is OPPONENT — opponent serve placement is out of scope.
  location: ServeZone | FailureMode | null;
}

function isCourtSide(value: unknown): value is CourtSide {
  return COURT_SIDES.includes(value as CourtSide);
}

function isServeTarget(value: unknown): value is ServeTarget {
  return SERVE_TARGETS.includes(value as ServeTarget);
}

function isFailureMode(value: unknown): value is FailureMode {
  return FAILURE_MODES.includes(value as FailureMode);
}

function isServeZone(value: unknown): value is ServeZone {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return isCourtSide(data.box) && isServeTarget(data.target);
}

function isCourtZone(value: unknown): value is CourtZone {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return isCourtSide(data.half) && COURT_DEPTHS.includes(data.depth as CourtDepth);
}

// Structural shape only — number/outcome/location's *type* is plausible, not whether
// that combination is right for this point's server/outcome. Point.create checks that.
function isServeAttempt(value: unknown): value is ServeAttempt {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (data.number !== 1 && data.number !== 2) return false;
  if (!SERVE_OUTCOMES.includes(data.outcome as ServeOutcome)) return false;
  return data.location === null || isServeZone(data.location) || isFailureMode(data.location);
}

// Plain objects with only primitive fields, so a shallow spread is a full deep copy.
// null and FailureMode (a string) pass through unchanged.
function copyLocation<T extends ServeZone | CourtZone | FailureMode | null>(location: T): T {
  if (location === null || typeof location === "string") return location;
  return { ...(location as unknown as Record<string, unknown>) } as unknown as T;
}

function copyServeAttempt(attempt: ServeAttempt): ServeAttempt {
  return {
    number: attempt.number,
    outcome: attempt.outcome,
    location: copyLocation(attempt.location),
  };
}

// --- Point ---------------------------------------------------------------------

export class Point {
  readonly id: string;
  readonly matchId: string;
  readonly timestamp: number;
  // Ordering within the match; scoring (state.ts) replays points in this order.
  readonly sequence: number;
  readonly server: Server;
  // Length 1 or 2 — length 2 implies a first-serve fault. Both faulted implies
  // endReason DOUBLE_FAULT.
  readonly serves: readonly ServeAttempt[];
  // Only set when server is OPPONENT.
  readonly returnOutcome: ReturnOutcome | null;
  readonly won: boolean;
  readonly endReason: EndReason;
  // Unusual points only — null otherwise, and optional even on one.
  readonly unusualReason: UnusualReason | null;
  readonly unusualNote: string | null;
  // Null when there was no contact, or on ACE / DOUBLE_FAULT / UNUSUAL. Describes
  // whichever player hit last — see lastShotPlayer.
  readonly wing: Wing | null;
  readonly shotType: ShotType | null;
  readonly ballIn: boolean | null;
  readonly ballLocation: CourtZone | FailureMode | null;
  // Null means genuinely unknown — never a stand-in for a rally of length 0.
  readonly rallyLengthBucket: RallyBucket | null;

  // Takes already-validated, already-copied data — Point.create is the only caller,
  // and it's the one responsible for defensively deep-copying serves/ballLocation so a
  // Point can't be mutated later through a reference the caller kept.
  private constructor(fields: {
    id: string;
    matchId: string;
    timestamp: number;
    sequence: number;
    server: Server;
    serves: readonly ServeAttempt[];
    returnOutcome: ReturnOutcome | null;
    won: boolean;
    endReason: EndReason;
    unusualReason: UnusualReason | null;
    unusualNote: string | null;
    wing: Wing | null;
    shotType: ShotType | null;
    ballIn: boolean | null;
    ballLocation: CourtZone | FailureMode | null;
    rallyLengthBucket: RallyBucket | null;
  }) {
    this.id = fields.id;
    this.matchId = fields.matchId;
    this.timestamp = fields.timestamp;
    this.sequence = fields.sequence;
    this.server = fields.server;
    this.serves = fields.serves;
    this.returnOutcome = fields.returnOutcome;
    this.won = fields.won;
    this.endReason = fields.endReason;
    this.unusualReason = fields.unusualReason;
    this.unusualNote = fields.unusualNote;
    this.wing = fields.wing;
    this.shotType = fields.shotType;
    this.ballIn = fields.ballIn;
    this.ballLocation = fields.ballLocation;
    this.rallyLengthBucket = fields.rallyLengthBucket;
  }

  static create(input: unknown): Point {
    if (typeof input !== "object" || input === null) {
      throw new Error("point data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new Error("point id must be a non-empty string");
    }
    if (typeof data.matchId !== "string" || data.matchId.length === 0) {
      throw new Error("point matchId must be a non-empty string");
    }
    if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp)) {
      throw new Error("point timestamp must be a finite number");
    }
    if (
      typeof data.sequence !== "number" ||
      !Number.isInteger(data.sequence) ||
      data.sequence < 0
    ) {
      throw new Error("point sequence must be a non-negative integer");
    }
    if (!SERVERS.includes(data.server as Server)) {
      throw new Error(`invalid server: ${String(data.server)}`);
    }
    const server = data.server as Server;

    if (!Array.isArray(data.serves) || (data.serves.length !== 1 && data.serves.length !== 2)) {
      throw new Error("serves must be an array of length 1 or 2");
    }
    const serves: ServeAttempt[] = (data.serves as unknown[]).map((raw, index) => {
      if (!isServeAttempt(raw)) {
        throw new Error(`serves[${index}] is not a valid ServeAttempt`);
      }
      if (raw.number !== index + 1) {
        throw new Error(`serves[${index}].number must be ${index + 1}`);
      }
      if (server === "OPPONENT") {
        if (raw.location !== null) {
          throw new Error(`serves[${index}].location must be null when server is OPPONENT`);
        }
      } else if (raw.outcome === "FAULT") {
        if (!isFailureMode(raw.location)) {
          throw new Error(`serves[${index}].location must be a FailureMode when outcome is FAULT`);
        }
      } else if (!isServeZone(raw.location)) {
        throw new Error(
          `serves[${index}].location must be a ServeZone when outcome is ${raw.outcome}`,
        );
      }
      return copyServeAttempt(raw);
    });

    // A faulted first serve always demands a second attempt, and a second attempt only
    // ever follows one — the two conditions are enforced in both directions.
    if (serves[0]?.outcome === "FAULT" && serves.length !== 2) {
      throw new Error("a faulted first serve must be followed by a second serve attempt");
    }
    if (serves.length === 2 && serves[0]?.outcome !== "FAULT") {
      throw new Error("a second serve attempt requires the first serve to have faulted");
    }
    const bothFaulted =
      serves.length === 2 && serves[0]?.outcome === "FAULT" && serves[1]?.outcome === "FAULT";

    let returnOutcome: ReturnOutcome | null = null;
    if (server === "TRACKED") {
      if (data.returnOutcome !== null && data.returnOutcome !== undefined) {
        throw new Error("returnOutcome must be null when server is TRACKED");
      }
    } else if (data.returnOutcome !== null && data.returnOutcome !== undefined) {
      if (!RETURN_OUTCOMES.includes(data.returnOutcome as ReturnOutcome)) {
        throw new Error(`invalid returnOutcome: ${String(data.returnOutcome)}`);
      }
      returnOutcome = data.returnOutcome as ReturnOutcome;
    }

    if (typeof data.won !== "boolean") {
      throw new Error("won must be a boolean");
    }
    if (!END_REASONS.includes(data.endReason as EndReason)) {
      throw new Error(`invalid endReason: ${String(data.endReason)}`);
    }
    const endReason = data.endReason as EndReason;

    if (bothFaulted && endReason !== "DOUBLE_FAULT") {
      throw new Error("a point with both serves faulted must have endReason DOUBLE_FAULT");
    }
    if (endReason === "DOUBLE_FAULT" && !bothFaulted) {
      throw new Error("endReason DOUBLE_FAULT requires both serves to have faulted");
    }

    if (
      data.unusualReason !== null &&
      !UNUSUAL_REASONS.includes(data.unusualReason as UnusualReason)
    ) {
      throw new Error(`invalid unusualReason: ${String(data.unusualReason)}`);
    }
    if (endReason !== "UNUSUAL" && data.unusualReason !== null) {
      throw new Error("unusualReason must be null when endReason is not UNUSUAL");
    }
    const unusualReason = data.unusualReason as UnusualReason | null;

    if (
      data.unusualNote !== null &&
      (typeof data.unusualNote !== "string" || data.unusualNote.length === 0)
    ) {
      throw new Error("unusualNote must be a non-empty string, or null");
    }
    if (endReason !== "UNUSUAL" && data.unusualNote !== null) {
      throw new Error("unusualNote must be null when endReason is not UNUSUAL");
    }
    const unusualNote = data.unusualNote as string | null;

    // No contact happened for these three — nothing to describe.
    const noContact =
      endReason === "ACE" || endReason === "DOUBLE_FAULT" || endReason === "UNUSUAL";

    if (noContact) {
      if (data.wing !== null || data.shotType !== null) {
        throw new Error("wing and shotType must be null for ACE, DOUBLE_FAULT, and UNUSUAL points");
      }
    } else {
      const wingSet = data.wing !== null;
      const shotTypeSet = data.shotType !== null;
      if (wingSet !== shotTypeSet) {
        throw new Error("wing and shotType must be set together, or both null");
      }
      if (wingSet && !WINGS.includes(data.wing as Wing)) {
        throw new Error(`invalid wing: ${String(data.wing)}`);
      }
      if (shotTypeSet && !SHOT_TYPES.includes(data.shotType as ShotType)) {
        throw new Error(`invalid shotType: ${String(data.shotType)}`);
      }
    }
    const wing = data.wing as Wing | null;
    const shotType = data.shotType as ShotType | null;

    if (noContact) {
      if (data.ballIn !== null || data.ballLocation !== null) {
        throw new Error(
          "ballIn and ballLocation must be null for ACE, DOUBLE_FAULT, and UNUSUAL points",
        );
      }
    } else if (typeof data.ballIn !== "boolean") {
      throw new Error("ballIn must be a boolean for FORCED and MISTAKE points");
    } else if (data.ballIn) {
      if (!isCourtZone(data.ballLocation)) {
        throw new Error("ballLocation must be a CourtZone when ballIn is true");
      }
    } else if (!isFailureMode(data.ballLocation)) {
      throw new Error("ballLocation must be a FailureMode when ballIn is false");
    }
    const ballIn = data.ballIn as boolean | null;
    const ballLocation = copyLocation(data.ballLocation as CourtZone | FailureMode | null);

    if (
      data.rallyLengthBucket !== null &&
      !RALLY_BUCKETS.includes(data.rallyLengthBucket as RallyBucket)
    ) {
      throw new Error(`invalid rallyLengthBucket: ${String(data.rallyLengthBucket)}`);
    }
    const rallyLengthBucket = data.rallyLengthBucket as RallyBucket | null;

    return new Point({
      id: data.id,
      matchId: data.matchId,
      timestamp: data.timestamp,
      sequence: data.sequence,
      server,
      serves,
      returnOutcome,
      won: data.won,
      endReason,
      unusualReason,
      unusualNote,
      wing,
      shotType,
      ballIn,
      ballLocation,
      rallyLengthBucket,
    });
  }

  static fromJSON(json: unknown): Point {
    return Point.create(json);
  }

  toJSON() {
    return {
      id: this.id,
      matchId: this.matchId,
      timestamp: this.timestamp,
      sequence: this.sequence,
      server: this.server,
      // Deep-copied, not the live array/objects: serves holds nested location objects,
      // so a shallow spread alone would let a caller mutate this Point through them.
      serves: this.serves.map(copyServeAttempt),
      returnOutcome: this.returnOutcome,
      won: this.won,
      endReason: this.endReason,
      unusualReason: this.unusualReason,
      unusualNote: this.unusualNote,
      wing: this.wing,
      shotType: this.shotType,
      ballIn: this.ballIn,
      ballLocation: copyLocation(this.ballLocation),
      rallyLengthBucket: this.rallyLengthBucket,
    };
  }

  /** Derived, not stored — on a win the last ball was ours, on a loss the opponent's. */
  get lastShotPlayer(): Server {
    return this.won ? "TRACKED" : "OPPONENT";
  }

  /** Derived, not stored. */
  get firstServeIn(): boolean {
    return this.serves.length === 1;
  }

  get isAce(): boolean {
    return this.endReason === "ACE";
  }

  get isDoubleFault(): boolean {
    return this.serves.length === 2 && this.serves[1]?.outcome === "FAULT";
  }
}
