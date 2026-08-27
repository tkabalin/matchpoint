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

// UNKNOWN is a serve nobody recorded, not a fourth thing a serve can do: the coach
// skipped the point rather than captured it. It exists so serve percentages can
// exclude those points instead of counting a guess as a real first serve in.
export type ServeOutcome = "IN" | "FAULT" | "ACE" | "UNKNOWN";
export const SERVE_OUTCOMES: readonly ServeOutcome[] = ["IN", "FAULT", "ACE", "UNKNOWN"];

// Shared by Point.courtSide and CourtZone.half — the same two physical sides of the court.
export type CourtSide = "DEUCE" | "AD";
export const COURT_SIDES: readonly CourtSide[] = ["DEUCE", "AD"];

export type ServeTarget = "WIDE" | "BODY" | "T";
export const SERVE_TARGETS: readonly ServeTarget[] = ["WIDE", "BODY", "T"];

export type FailureMode = "NET" | "LONG" | "WIDE";
export const FAILURE_MODES: readonly FailureMode[] = ["NET", "LONG", "WIDE"];

// A missed return carries its own placement — no separate ballLocation capture, see
// Point.create's isReturnError check below.
export type ReturnOutcome = "IN" | FailureMode;
export const RETURN_OUTCOMES: readonly ReturnOutcome[] = ["IN", ...FAILURE_MODES];

// Two bands, not three: players asked for short vs deep, which is the call a coach can
// make reliably from the sideline. DEEP rather than "long" deliberately — LONG is a
// FailureMode, a ball that missed beyond the baseline, and these are balls that landed.
export type CourtDepth = "SHORT" | "DEEP";
export const COURT_DEPTHS: readonly CourtDepth[] = ["SHORT", "DEEP"];

export type RallyBucket = "B1" | "B2" | "B3" | "B4";
export const RALLY_BUCKETS: readonly RallyBucket[] = ["B1", "B2", "B3", "B4"];

// Mirrors PointCreate.note in the API, which is LongText (max_length 2000). The bound
// lives here so the note sheet and the model agree on it, since a longer note would
// 422 the batch it syncs in and park every other point in that batch with it.
export const NOTE_MAX_LENGTH = 2000;

// --- Compound types ----------------------------------------------------------------

// Where the last ball to land, landed — six zones (side x depth).
export interface CourtZone {
  half: CourtSide;
  depth: CourtDepth;
}

export interface ServeAttempt {
  number: 1 | 2;
  outcome: ServeOutcome;
  // Three zones, not raw coordinates — a coach watching live cannot place a
  // coordinate reliably, and wide/body/T is how coaches already think about serve
  // targets. Non-null only for the tracked player's own serve: a FailureMode when it
  // faulted (why it missed), and optionally a ServeTarget when it went in or aced —
  // null there means placement wasn't captured, which is what the one-tap capture
  // screen records: that the ball landed in the box, not where inside it.
  // Always null for an UNKNOWN serve, which by definition has nothing to place, and
  // for an OPPONENT serve — placement there is out of scope. Which
  // physical side (deuce/ad) the serve came from is Point.courtSide, not part of
  // this — that fact belongs to the whole point, not just the tracked player's serve.
  location: ServeTarget | FailureMode | null;
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
  return data.location === null || isServeTarget(data.location) || isFailureMode(data.location);
}

// Plain objects with only primitive fields, so a shallow spread is a full deep copy.
// null and FailureMode (a string) pass through unchanged.
function copyLocation<T extends CourtZone | FailureMode | null>(location: T): T {
  if (location === null || typeof location === "string") return location;
  return { ...(location as unknown as Record<string, unknown>) } as unknown as T;
}

// No copyLocation call needed here, unlike ballLocation below — a ServeAttempt's
// location is always a primitive (ServeTarget/FailureMode string, or null), never an
// object, so there's nothing for a caller to mutate through a shared reference.
function copyServeAttempt(attempt: ServeAttempt): ServeAttempt {
  return {
    number: attempt.number,
    outcome: attempt.outcome,
    location: attempt.location,
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
  // Which physical side of the court this point was played from — shared by both
  // players regardless of who serves, unlike ServeAttempt.location's target (see its
  // own comment). See CourtSide's own comment.
  readonly courtSide: CourtSide;
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
  // A coach's free-text annotation on any point, not only an unusual one — distinct
  // from unusualNote above, which only ever accompanies an UNUSUAL end reason.
  readonly note: string | null;
  // Null on ACE / DOUBLE_FAULT / UNUSUAL (no contact) and on a return error (returnOutcome
  // already describes it). Otherwise describes whichever player hit last — see lastShotPlayer.
  // Also null on an unforced error, whose stroke capture doesn't ask for.
  readonly wing: Wing | null;
  readonly shotType: ShotType | null;
  // Where the last ball to *land* finished, which on an unforced error is the shot
  // before the miss, not the miss itself: capture records the rally's shape, and where
  // an error went is a fact coaches said they don't act on. So ballIn is always true
  // from the capture path; false plus a FailureMode stays legal for imported data.
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
    courtSide: CourtSide;
    serves: readonly ServeAttempt[];
    returnOutcome: ReturnOutcome | null;
    won: boolean;
    endReason: EndReason;
    unusualReason: UnusualReason | null;
    unusualNote: string | null;
    note: string | null;
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
    this.courtSide = fields.courtSide;
    this.serves = fields.serves;
    this.returnOutcome = fields.returnOutcome;
    this.won = fields.won;
    this.endReason = fields.endReason;
    this.unusualReason = fields.unusualReason;
    this.unusualNote = fields.unusualNote;
    this.note = fields.note;
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

    if (!isCourtSide(data.courtSide)) {
      throw new Error(`invalid courtSide: ${String(data.courtSide)}`);
    }
    const courtSide = data.courtSide as CourtSide;

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
      } else if (raw.outcome === "UNKNOWN") {
        if (raw.location !== null) {
          throw new Error(`serves[${index}].location must be null when outcome is UNKNOWN`);
        }
      } else if (raw.outcome === "FAULT") {
        if (!isFailureMode(raw.location)) {
          throw new Error(`serves[${index}].location must be a FailureMode when outcome is FAULT`);
        }
      } else if (raw.location !== null && !isServeTarget(raw.location)) {
        throw new Error(
          `serves[${index}].location must be a ServeTarget or null when outcome is ${raw.outcome}`,
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

    // A serve nobody saw can only belong to a point nobody saw the end of either.
    // Nothing structural is needed to keep UNKNOWN last: the second-attempt rule above
    // already rejects anything following it.
    if (serves.some((serve) => serve.outcome === "UNKNOWN") && endReason !== "UNUSUAL") {
      throw new Error("a point with an unrecorded serve must have endReason UNUSUAL");
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

    // No endReason coupling, unlike unusualNote above — a coach can annotate any
    // point, so this is just a plain nullable string.
    if (data.note !== null && (typeof data.note !== "string" || data.note.length === 0)) {
      throw new Error("note must be a non-empty string, or null");
    }
    // Truncated rather than rejected: notes append, so even bounded ones can add up
    // past NOTE_MAX_LENGTH, and losing a note's tail costs the coach far less than
    // losing the point.
    const note = data.note === null ? null : (data.note as string).slice(0, NOTE_MAX_LENGTH);

    // ACE/DOUBLE_FAULT/UNUSUAL never had a shot to describe. A missed return did have
    // contact, but returnOutcome already says where it went — asking wing/shotType/
    // ballLocation again would just recapture the same fact under a second name.
    const isReturnError = returnOutcome !== null && returnOutcome !== "IN";
    const noContact =
      endReason === "ACE" ||
      endReason === "DOUBLE_FAULT" ||
      endReason === "UNUSUAL" ||
      isReturnError;

    if (noContact) {
      if (data.wing !== null || data.shotType !== null) {
        throw new Error(
          "wing and shotType must be null for ACE, DOUBLE_FAULT, UNUSUAL, and return-error points",
        );
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
          "ballIn and ballLocation must be null for ACE, DOUBLE_FAULT, UNUSUAL, and return-error points",
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
      courtSide,
      serves,
      returnOutcome,
      won: data.won,
      endReason,
      unusualReason,
      unusualNote,
      note,
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
      courtSide: this.courtSide,
      // Deep-copied, not the live array: each ServeAttempt is its own object, so a
      // shallow spread of the array alone would let a caller mutate this Point
      // through the objects it still shares.
      serves: this.serves.map(copyServeAttempt),
      returnOutcome: this.returnOutcome,
      won: this.won,
      endReason: this.endReason,
      unusualReason: this.unusualReason,
      unusualNote: this.unusualNote,
      note: this.note,
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

  /** Derived, not stored — null when the first serve was never recorded, which is not
   * the same as it having missed. Serve percentages must drop those, not count them. */
  get firstServeIn(): boolean | null {
    if (this.serves[0]?.outcome === "UNKNOWN") return null;
    return this.serves.length === 1;
  }

  get isAce(): boolean {
    return this.endReason === "ACE";
  }

  get isDoubleFault(): boolean {
    return this.serves.length === 2 && this.serves[1]?.outcome === "FAULT";
  }
}
