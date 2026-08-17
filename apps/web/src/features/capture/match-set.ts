/**
 * Live scoring domain model — MatchSet.
 *
 * Sits between Match and Game in the Point → Game → Set → Match hierarchy
 * (see the module doc comment in `match.ts`). Named `MatchSet` rather than
 * `Set` because `Set` is already the built-in JS/TS collection type —
 * reusing that name here would shadow it for this whole module.
 *
 * Referenced by `matchId`, not embedded in `Match` — same reasoning as
 * `Point.gameId` (see point.ts): a MatchSet needs to survive being handled
 * on its own (outbox, sync), so it can't assume its parent Match is in
 * scope. That's also why `trackedPlayerId`/`opponentId` are threaded down
 * as MatchSet's own copies rather than looked up from Match — a flat
 * record needs them to validate `winner` by itself, the same reason
 * Point carries its own copies to validate `winner`/`server`.
 *
 * TODO: this is a first pass — only `setNumber` and the game score are
 * recorded here. Rule-resolution (tiebreak-at, ad-scoring, ...) isn't built
 * yet; it needs real numbers confirmed against the brief/BBD first, same
 * caveat as `maxSetsFor` in `match.ts`. `winner` is stored, not derived,
 * matching Point's `winner`/`server` — cross-field tennis rules aren't
 * re-checked here, same reasoning as Point.create (see point.ts). Nor is
 * setNumber checked for being sequential/within the format's max — that's
 * a cross-MatchSet check, which (like Point's cross-field rules) belongs
 * to whatever appends a new set, not to validating one set in isolation.
 */
export class MatchSet {
  readonly matchId: string;
  // 1-indexed position within the match — which set this is, e.g. so a
  // match-tiebreak format can tell "the deciding set" apart from the rest.
  readonly setNumber: number;
  readonly trackedPlayerId: string;
  readonly opponentId: string;
  readonly trackedPlayerGames: number;
  readonly opponentGames: number;
  // Must equal trackedPlayerId or opponentId, or null while the set is
  // still in progress — checked in MatchSet.create.
  readonly winner: string | null;

  private constructor(fields: {
    matchId: string;
    setNumber: number;
    trackedPlayerId: string;
    opponentId: string;
    trackedPlayerGames: number;
    opponentGames: number;
    winner: string | null;
  }) {
    this.matchId = fields.matchId;
    this.setNumber = fields.setNumber;
    this.trackedPlayerId = fields.trackedPlayerId;
    this.opponentId = fields.opponentId;
    this.trackedPlayerGames = fields.trackedPlayerGames;
    this.opponentGames = fields.opponentGames;
    this.winner = fields.winner;
  }

  // TODO: rough first pass at structural checks, matching Point.create's approach —
  // revisit once the outbox/sync layer settles on how untrusted this input really is.
  static create(input: unknown): MatchSet {
    if (typeof input !== "object" || input === null) {
      throw new Error("match set data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.matchId !== "string" || data.matchId.length === 0) {
      throw new Error("matchId must be a non-empty string");
    }
    if (
      typeof data.setNumber !== "number" ||
      !Number.isInteger(data.setNumber) ||
      data.setNumber < 1
    ) {
      throw new Error("setNumber must be a positive integer");
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
    if (
      typeof data.trackedPlayerGames !== "number" ||
      !Number.isInteger(data.trackedPlayerGames) ||
      data.trackedPlayerGames < 0
    ) {
      throw new Error("trackedPlayerGames must be a non-negative integer");
    }
    if (
      typeof data.opponentGames !== "number" ||
      !Number.isInteger(data.opponentGames) ||
      data.opponentGames < 0
    ) {
      throw new Error("opponentGames must be a non-negative integer");
    }
    const participants = [data.trackedPlayerId, data.opponentId];
    if (data.winner !== null && !participants.includes(data.winner as string)) {
      throw new Error(
        `winner must be trackedPlayerId, opponentId, or null, got: ${String(data.winner)}`,
      );
    }

    return new MatchSet({
      matchId: data.matchId,
      setNumber: data.setNumber,
      trackedPlayerId: data.trackedPlayerId,
      opponentId: data.opponentId,
      trackedPlayerGames: data.trackedPlayerGames,
      opponentGames: data.opponentGames,
      winner: data.winner as string | null,
    });
  }

  static fromJSON(json: unknown): MatchSet {
    return MatchSet.create(json);
  }

  toJSON() {
    return {
      matchId: this.matchId,
      setNumber: this.setNumber,
      trackedPlayerId: this.trackedPlayerId,
      opponentId: this.opponentId,
      trackedPlayerGames: this.trackedPlayerGames,
      opponentGames: this.opponentGames,
      winner: this.winner,
    };
  }
}
