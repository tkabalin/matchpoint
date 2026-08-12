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

// From the tracked player's perspective. Not who served — see `winner`/`server`.
export type PointOutcome = "win" | "loss";
export const POINT_OUTCOMES: readonly PointOutcome[] = ["win", "loss"];

export type ErrorType = "forced_error" | "unforced_error";
export const ERROR_TYPES: readonly ErrorType[] = ["forced_error", "unforced_error"];

// TODO: revisit once the capture UI is built — this list is provisional, to be
// refined once we know what a coach can realistically tag in one tap.
export type ShotType = "forehand" | "backhand" | "volley" | "slice" | "drop_shot" | "lob";
export const SHOT_TYPES: readonly ShotType[] = [
  "forehand",
  "backhand",
  "volley",
  "slice",
  "drop_shot",
  "lob",
];

function isShotType(value: unknown): value is ShotType {
  return SHOT_TYPES.includes(value as ShotType);
}

// TODO: "net" is the only reason tracked so far — others (long, wide, ...) will
// likely follow. Nullable on ErrorDetail below since not every error has a reason
// worth tagging yet.
export type ErrorReason = "net";
export const ERROR_REASONS: readonly ErrorReason[] = ["net"];

// The shot that set up the error, whether the error was forced or unforced, and —
// optionally — why it went wrong (e.g. into the net). The ShotType always belongs to
// whoever did *not* error — the last shot the other side hit before it. On `winBy`
// that's the tracked player's own last shot, the one the opponent erred trying to
// handle; on `lossBy` it's the opponent's last shot, the one the tracked player
// erred trying to handle. Null on both when the point ended on a clean winner
// instead of an error (see `isAce` below for the other way a point can end with
// neither populated).
export type ErrorDetail = readonly [ErrorType, ShotType, ErrorReason | null];

function isErrorDetail(value: unknown): value is ErrorDetail {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    ERROR_TYPES.includes(value[0] as ErrorType) &&
    isShotType(value[1]) &&
    (value[2] === null || ERROR_REASONS.includes(value[2] as ErrorReason))
  );
}

// --- Point ---------------------------------------------------------------------

/**
 * Live scoring Point.
 *
 * Construct via `Point.create()` (validates structurally) or `Point.fromJSON()`
 * (rehydrate from the outbox); never `new Point(...)` directly. Cross-field tennis
 * rules aren't re-checked here — every Point, including one shared in from another
 * coach, was already built through that coach's own capture UI, which is the one
 * place responsible for only ever producing consistent combinations. `toJSON()` is
 * what actually gets written to Dexie.
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
  readonly trackedPlayerShots: readonly ShotType[];
  // null = opponent's shots not recorded yet; [] = recorded, and there were none.
  readonly opponentShots: readonly ShotType[] | null;
  readonly winBy: ErrorDetail | null;
  readonly lossBy: ErrorDetail | null;

  // Takes already-validated, already-copied arrays — Point.create is the only
  // caller, and it's the one responsible for defensively copying trackedPlayerShots/
  // opponentShots so a Point can't be mutated later through a reference the caller
  // kept. Without that, `readonly` here only stops reassignment, not `.push(...)`
  // on the array itself.
  private constructor(fields: {
    id: string;
    gameId: string;
    trackedPlayerId: string;
    opponentId: string;
    serveNumber: ServeNumber;
    outcome: PointOutcome;
    winner: string;
    server: string;
    trackedPlayerShots: readonly ShotType[];
    opponentShots: readonly ShotType[] | null;
    winBy: ErrorDetail | null;
    lossBy: ErrorDetail | null;
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
    this.winBy = fields.winBy;
    this.lossBy = fields.lossBy;
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
    // Copied, not the caller's array: otherwise mutating it after Point.create()
    // returns would silently mutate this "already-validated" Point too.
    const trackedPlayerShots = [...(data.trackedPlayerShots as ShotType[])];

    let opponentShots: ShotType[] | null = null;
    if (data.opponentShots !== null) {
      if (!Array.isArray(data.opponentShots) || !data.opponentShots.every(isShotType)) {
        throw new Error("opponentShots must be an array of shot types, or null");
      }
      opponentShots = [...(data.opponentShots as ShotType[])];
    }

    if (data.winBy !== null && !isErrorDetail(data.winBy)) {
      throw new Error("winBy must be an [ErrorType, ShotType] tuple, or null");
    }
    if (data.lossBy !== null && !isErrorDetail(data.lossBy)) {
      throw new Error("lossBy must be an [ErrorType, ShotType] tuple, or null");
    }

    return new Point({
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
      winBy: data.winBy as ErrorDetail | null,
      lossBy: data.lossBy as ErrorDetail | null,
    });
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
      // Copied, not the live arrays: otherwise a caller mutating the returned
      // snapshot (e.g. before writing it to Dexie) would mutate this Point too.
      trackedPlayerShots: [...this.trackedPlayerShots],
      opponentShots: this.opponentShots === null ? null : [...this.opponentShots],
      winBy: this.winBy,
      lossBy: this.lossBy,
    };
  }

  get opponentDataComplete(): boolean {
    return this.opponentShots !== null;
  }

  /**
   * An ace isn't its own outcome anymore — it's the server also winning the point,
   * with an untouched serve: no rally shots on either side and no error detail (an
   * ace isn't an error). Works either way round — an ace for the tracked player or
   * one served against them; `winner` tells you which. Only reliable once
   * `opponentDataComplete`; until then, an unrecorded `opponentShots` is assumed
   * empty, same as `rallyLength`.
   */
  get isAce(): boolean {
    return (
      this.winner === this.server &&
      this.trackedPlayerShots.length === 0 &&
      (this.opponentShots?.length ?? 0) === 0 &&
      this.winBy === null &&
      this.lossBy === null
    );
  }

  /**
   * A double fault isn't its own outcome either — it's the server instead *losing*
   * their own service point, on the second serve, with no rally shots on either side
   * (the serve itself was the fault, so nothing was ever returned) and no error
   * detail (a double fault is a serve fault, not a groundstroke error — there's no
   * ShotType for "serve"). Works either way round, same as `isAce`. Same
   * `opponentDataComplete` caveat.
   */
  get isDoubleFault(): boolean {
    return (
      this.winner !== this.server &&
      this.serveNumber === "second" &&
      this.trackedPlayerShots.length === 0 &&
      (this.opponentShots?.length ?? 0) === 0 &&
      this.winBy === null &&
      this.lossBy === null
    );
  }

  /**
   * Derived, not stored. Undercounts while `opponentShots` is still null —
   * check `opponentDataComplete` before trusting this for stats that need the
   * full rally.
   */
  get rallyLength(): number {
    return this.trackedPlayerShots.length + (this.opponentShots?.length ?? 0);
  }

  /**
   * The exact rally shot count, without needing `opponentShots` recorded at all.
   * Rally shots strictly alternate starting with the returner, so `server` plus
   * `trackedPlayerShots.length` fixes how many shots the opponent hit *up to the
   * tracked player's last one* — the only remaining question is whether the rally
   * ended right there or continued one more shot. `outcome` plus `winBy`/`lossBy`
   * answers that: a clean win/loss (winBy/lossBy null) means the winner's own shot
   * ended the rally; a win/loss by error means the loser's failed shot did — either
   * way, that tells us exactly who hit last, so there's no ambiguity left.
   */
  get exactRallyLength(): number {
    const trackedCount = this.trackedPlayerShots.length;
    if (trackedCount === 0) return 0;

    const trackedServed = this.server === this.trackedPlayerId;
    const trackedHitLast = this.outcome === "win" ? this.winBy === null : this.lossBy !== null;

    if (trackedServed) {
      // Tracked player served, so alternation is opponent, tracked, opponent, ... —
      // the tracked player's last shot lands at position 2 * trackedCount.
      return trackedHitLast ? trackedCount * 2 : trackedCount * 2 + 1;
    }
    // Opponent served, so alternation is tracked, opponent, tracked, opponent, ... —
    // the tracked player's last shot lands at position 2 * trackedCount - 1.
    return trackedHitLast ? trackedCount * 2 - 1 : trackedCount * 2;
  }

  /**
   * For when a coach can only estimate how long a rally ran (e.g. reconstructing
   * from memory) rather than knowing it exactly. Takes the coach's best-guess
   * range and returns its midpoint, rounded to the nearest whole shot.
   */
  approximateRallyLength(estimatedRange: { min: number; max: number }): number {
    if (estimatedRange.min < 0 || estimatedRange.max < estimatedRange.min) {
      throw new Error("invalid rally length range");
    }
    return Math.round((estimatedRange.min + estimatedRange.max) / 2);
  }
}
