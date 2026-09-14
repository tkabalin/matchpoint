/**
 * Live scoring domain model — Point.
 *
 * Every point is recorded from the tracked player's point of view: `won` is the tracked
 * player's win/loss and `server` is a role ("TRACKED" | "OPPONENT"), not an id — so unlike
 * the model this replaces, a Point stores no `gameId` or `trackedPlayerId`/`opponentId`;
 * game membership is `context`, and `server`/`won` alone make a Point self-describing.
 * Construct via `Point.create()`/`Point.fromJSON()`, never `new Point(...)`.
 *
 * A Point's fields fall in two groups, and the split is the whole point of this model:
 *
 * - **Score facts, never null.** `won`, `server`, `courtSide`, `sequence` and `context`.
 *   A Point is one point the coach vouches for, at minimum its winner, so the score can
 *   always be folded from it.
 * - **Observation fields, each nullable.** Null means "not seen" (or not applicable,
 *   which analytics treat identically). A coach who watched the rally but not the serve
 *   records `serves: []`; one who saw only who won records every one of them null.
 *
 * `create()` validates shape and "if present, must cohere" — a second serve still needs
 * a faulted first, ACE and DOUBLE_FAULT still need the serves that prove them — never
 * whether the coach *should* have seen more.
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

// Three outcomes, not four: a serve nobody watched is absent from `serves` entirely
// rather than present as an UNKNOWN one. An enum member for "not seen" needed every
// serve aggregate to remember a filter, and had no backend member to sync to.
export type ServeOutcome = "IN" | "FAULT" | "ACE";
export const SERVE_OUTCOMES: readonly ServeOutcome[] = ["IN", "FAULT", "ACE"];

// Shared by Point.courtSide and CourtZone.half — the same two physical sides of the court.
export type CourtSide = "DEUCE" | "AD";
export const COURT_SIDES: readonly CourtSide[] = ["DEUCE", "AD"];

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
  // Why a faulted serve missed, and null for anything that landed. The serve screen
  // taps the box `Point.courtSide` already fixes, so a serve that went in records that
  // it landed, never where inside the box (wide/body/T is out of scope on both sides
  // of the wire). Always null for an OPPONENT serve — placement there isn't captured.
  location: FailureMode | null;
}

/**
 * Where a point sat in the match when it was played — the nine facts analytics group
 * by, computed once at commit by probing the score fold (see `score.ts`'s `contextFor`)
 * and then frozen. Stored rather than re-derived because the fold's own history can
 * move under a point: a later score checkpoint corrects the scoreboard without
 * rewriting what the board said when this point was actually played.
 */
export interface PointContext {
  setNumber: number;
  // 1-indexed within its set. A breaker is a game number of its own, the same way
  // service rotation treats it as one game slot.
  gameNumber: number;
  inTiebreak: boolean;
  // True when the *receiver* winning this point would end the game, and its mirror for
  // the server. Both are true at no-ad deuce, where either side ends it.
  isBreakPoint: boolean;
  isGamePoint: boolean;
  isGameEnd: boolean;
  // True when either side winning would end the set (or the match) — a set point is a
  // set point for whoever it belongs to.
  isSetPoint: boolean;
  isSetEnd: boolean;
  isMatchPoint: boolean;
}

const CONTEXT_FLAGS = [
  "inTiebreak",
  "isBreakPoint",
  "isGamePoint",
  "isGameEnd",
  "isSetPoint",
  "isSetEnd",
  "isMatchPoint",
] as const;

function isCourtSide(value: unknown): value is CourtSide {
  return COURT_SIDES.includes(value as CourtSide);
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
  return data.location === null || isFailureMode(data.location);
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseContext(value: unknown): PointContext {
  if (typeof value !== "object" || value === null) {
    throw new Error("point context must be an object");
  }
  const data = value as Record<string, unknown>;
  if (!positiveInteger(data.setNumber)) {
    throw new Error("context.setNumber must be a positive integer");
  }
  if (!positiveInteger(data.gameNumber)) {
    throw new Error("context.gameNumber must be a positive integer");
  }
  for (const flag of CONTEXT_FLAGS) {
    if (typeof data[flag] !== "boolean") {
      throw new Error(`context.${flag} must be a boolean`);
    }
  }
  return {
    setNumber: data.setNumber as number,
    gameNumber: data.gameNumber as number,
    inTiebreak: data.inTiebreak as boolean,
    isBreakPoint: data.isBreakPoint as boolean,
    isGamePoint: data.isGamePoint as boolean,
    isGameEnd: data.isGameEnd as boolean,
    isSetPoint: data.isSetPoint as boolean,
    isSetEnd: data.isSetEnd as boolean,
    isMatchPoint: data.isMatchPoint as boolean,
  };
}

// Plain objects with only primitive fields, so a shallow spread is a full deep copy.
// null and FailureMode (a string) pass through unchanged.
function copyLocation<T extends CourtZone | FailureMode | null>(location: T): T {
  if (location === null || typeof location === "string") return location;
  return { ...(location as unknown as Record<string, unknown>) } as unknown as T;
}

// No copyLocation call needed here, unlike ballLocation below — a ServeAttempt's
// location is always a primitive (FailureMode string, or null), never an object, so
// there's nothing for a caller to mutate through a shared reference.
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
  // Ordering within the match; the score fold (score.ts) replays events in this order.
  readonly sequence: number;
  readonly server: Server;
  // Which physical side of the court this point was played from — shared by both
  // players regardless of who serves. See CourtSide's own comment.
  readonly courtSide: CourtSide;
  readonly won: boolean;
  readonly context: PointContext;
  // Length 0, 1 or 2. Empty is a serve nobody watched, a lone fault is a second serve
  // nobody watched, and both faulted implies endReason DOUBLE_FAULT.
  readonly serves: readonly ServeAttempt[];
  // Only set when server is OPPONENT, and only when a serve was observed — reaching
  // for "where did the return go" already implies the serve was in.
  readonly returnOutcome: ReturnOutcome | null;
  // Null when the coach didn't see how the point ended. Every field below that
  // describes the ending is then null too.
  readonly endReason: EndReason | null;
  // Unusual points only — null otherwise, and optional even on one.
  readonly unusualReason: UnusualReason | null;
  readonly unusualNote: string | null;
  // A coach's free-text annotation on any point, not only an unusual one — distinct
  // from unusualNote above, which only ever accompanies an UNUSUAL end reason.
  readonly note: string | null;
  // Null on ACE / DOUBLE_FAULT / UNUSUAL (no contact) and on a return error (returnOutcome
  // already describes it). Otherwise the last *successful* shot of the point — theirs on our
  // error, ours on a win (see lastShotPlayer) — not whoever hit last: on an error ending this
  // is their preceding ball, and ballIn/ballLocation (where our failed ball went) describe a
  // different stroke. Also null on an unforced error, whose stroke capture doesn't ask for.
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
    won: boolean;
    context: PointContext;
    serves: readonly ServeAttempt[];
    returnOutcome: ReturnOutcome | null;
    endReason: EndReason | null;
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
    this.won = fields.won;
    this.context = fields.context;
    this.serves = fields.serves;
    this.returnOutcome = fields.returnOutcome;
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

    if (typeof data.won !== "boolean") {
      throw new Error("won must be a boolean");
    }
    const context = parseContext(data.context);

    // Length 0 is a serve nobody watched — the one observation hole that isn't a
    // truncation of the flow's own order (a coach can miss the serve and still see
    // the rally it started).
    if (!Array.isArray(data.serves) || data.serves.length > 2) {
      throw new Error("serves must be an array of length 0, 1 or 2");
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
      } else if (raw.location !== null) {
        throw new Error(`serves[${index}].location must be null when outcome is ${raw.outcome}`);
      }
      return copyServeAttempt(raw);
    });

    // A second attempt only ever follows a faulted first. The reverse no longer holds:
    // a lone faulted serve is a coach who watched the fault and then missed what the
    // second serve did, which is an observation hole like any other.
    if (serves.length === 2 && serves[0]?.outcome !== "FAULT") {
      throw new Error("a second serve attempt requires the first serve to have faulted");
    }
    const bothFaulted =
      serves.length === 2 && serves[0]?.outcome === "FAULT" && serves[1]?.outcome === "FAULT";
    const acedServe = serves[serves.length - 1]?.outcome === "ACE";

    let returnOutcome: ReturnOutcome | null = null;
    if (data.returnOutcome !== null && data.returnOutcome !== undefined) {
      if (server === "TRACKED") {
        throw new Error("returnOutcome must be null when server is TRACKED");
      }
      if (!RETURN_OUTCOMES.includes(data.returnOutcome as ReturnOutcome)) {
        throw new Error(`invalid returnOutcome: ${String(data.returnOutcome)}`);
      }
      // The return is a fact about a serve that landed, so it can't outlive one that
      // was never watched.
      if (serves.length === 0) {
        throw new Error("returnOutcome requires an observed serve");
      }
      returnOutcome = data.returnOutcome as ReturnOutcome;
    }

    if (data.endReason !== null && !END_REASONS.includes(data.endReason as EndReason)) {
      throw new Error(`invalid endReason: ${String(data.endReason)}`);
    }
    const endReason = data.endReason as EndReason | null;

    if (bothFaulted && endReason !== "DOUBLE_FAULT") {
      throw new Error("a point with both serves faulted must have endReason DOUBLE_FAULT");
    }
    if (endReason === "DOUBLE_FAULT" && !bothFaulted) {
      throw new Error("endReason DOUBLE_FAULT requires both serves to have faulted");
    }
    if (acedServe && endReason !== "ACE") {
      throw new Error("a point whose serve was an ace must have endReason ACE");
    }
    if (endReason === "ACE" && !acedServe) {
      throw new Error("endReason ACE requires a serve recorded as an ace");
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
    // ballLocation again would just recapture the same fact under a second name. An
    // unseen ending (endReason null) has nothing to describe either.
    const isReturnError = returnOutcome !== null && returnOutcome !== "IN";
    const noContact =
      endReason === null ||
      endReason === "ACE" ||
      endReason === "DOUBLE_FAULT" ||
      endReason === "UNUSUAL" ||
      isReturnError;

    if (noContact) {
      if (data.wing !== null || data.shotType !== null) {
        throw new Error(
          "wing and shotType must be null for unseen, ACE, DOUBLE_FAULT, UNUSUAL, and return-error points",
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
          "ballIn and ballLocation must be null for unseen, ACE, DOUBLE_FAULT, UNUSUAL, and return-error points",
        );
      }
    } else if (data.ballIn === null) {
      // The coach saw the point end but not where the ball finished — the two travel
      // together, so neither is recorded.
      if (data.ballLocation !== null) {
        throw new Error("ballLocation must be null when ballIn is null");
      }
    } else if (typeof data.ballIn !== "boolean") {
      throw new Error("ballIn must be a boolean or null for FORCED and MISTAKE points");
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
      won: data.won,
      context,
      serves,
      returnOutcome,
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
      won: this.won,
      context: { ...this.context },
      // Deep-copied, not the live array: each ServeAttempt is its own object, so a
      // shallow spread of the array alone would let a caller mutate this Point
      // through the objects it still shares.
      serves: this.serves.map(copyServeAttempt),
      returnOutcome: this.returnOutcome,
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

  /** Derived, not stored — whoever hit the point's last *successful* shot, on a win ours,
   * on a loss the opponent's, never whoever's racket touched the ball last. On an error
   * ending that's the opponent's preceding ball, not our own missed shot. */
  get lastShotPlayer(): Server {
    return this.won ? "TRACKED" : "OPPONENT";
  }

  /** Derived, not stored — null when no serve was recorded, which is not the same as
   * one having missed. Serve percentages must drop those, not count them. Read off the
   * first attempt's own outcome, since a lone attempt may itself be a fault whose
   * second serve went unwatched. */
  get firstServeIn(): boolean | null {
    const first = this.serves[0];
    if (first === undefined) return null;
    return first.outcome !== "FAULT";
  }

  get isAce(): boolean {
    return this.endReason === "ACE";
  }

  get isDoubleFault(): boolean {
    return this.serves.length === 2 && this.serves[1]?.outcome === "FAULT";
  }
}
