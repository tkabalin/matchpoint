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
 * TODO: this is a first pass — only `setNumber`, the game score, and the
 * tiebreak score (if any) are recorded here. Rule-resolution (tiebreak-at,
 * ad-scoring, ...) isn't built yet; it needs real numbers confirmed against
 * the brief/BBD first, same caveat as `maxSetsFor` in `state.ts`. `winner`
 * is stored, not derived, matching Point's `winner`/`server` — cross-field
 * tennis rules aren't re-checked here, same reasoning as Point.create (see
 * point.ts). Nor is setNumber checked for being sequential/within the
 * format's max — that's a cross-MatchSet check, which (like Point's
 * cross-field rules) belongs to whatever appends a new set, not to
 * validating one set in isolation.
 */

/**
 * A set's breaker score, when it went to one — null otherwise.
 *
 * `target` (points needed to win the breaker, e.g. 7 or 10) travels with the
 * score rather than being re-derived from the match's ScoringSystem later:
 * a recorded set should be interpretable on its own, including for
 * cross-match analytics run well after the fact. Left as a plain `number`,
 * not a `7 | 10` literal union — short_sets' own target isn't confirmed
 * anywhere in the reference table (Fast4 variants commonly use 5, not 7),
 * so a hard-coded union would make that case unrepresentable.
 */
export interface TiebreakScore {
  trackedPlayerPoints: number;
  opponentPoints: number;
  target: number;
}

export class MatchSet {
  readonly matchId: string;
  // 1-indexed position within the match — which set this is, e.g. so a
  // match-tiebreak format can tell "the deciding set" apart from the rest.
  readonly setNumber: number;
  readonly trackedPlayerId: string;
  readonly opponentId: string;
  // For a match_tiebreak_10_points-decided set these stay 0/0 — the
  // "set" is the breaker outright, no games phase to credit from (see
  // setStateFor in state.ts). Correct storage, but a display layer must
  // never render that literally as "0-0" — the convention is the breaker
  // score in brackets, e.g. "[10-7]". Not built here; noted so whoever
  // builds the scoreboard doesn't render these two fields blindly.
  readonly trackedPlayerGames: number;
  readonly opponentGames: number;
  // Null unless the set was decided by a breaker (including the degenerate
  // match_tiebreak_10_points case, where trackedPlayerGames/opponentGames
  // stay 0/0 and this alone decides the set).
  readonly tiebreak: TiebreakScore | null;
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
    tiebreak: TiebreakScore | null;
    winner: string | null;
  }) {
    this.matchId = fields.matchId;
    this.setNumber = fields.setNumber;
    this.trackedPlayerId = fields.trackedPlayerId;
    this.opponentId = fields.opponentId;
    this.trackedPlayerGames = fields.trackedPlayerGames;
    this.opponentGames = fields.opponentGames;
    this.tiebreak = fields.tiebreak;
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
    let tiebreak: TiebreakScore | null = null;
    if (data.tiebreak !== null) {
      if (typeof data.tiebreak !== "object") {
        throw new Error("tiebreak must be an object, or null");
      }
      const tiebreakData = data.tiebreak as Record<string, unknown>;
      if (
        typeof tiebreakData.trackedPlayerPoints !== "number" ||
        !Number.isInteger(tiebreakData.trackedPlayerPoints) ||
        tiebreakData.trackedPlayerPoints < 0
      ) {
        throw new Error("tiebreak.trackedPlayerPoints must be a non-negative integer");
      }
      if (
        typeof tiebreakData.opponentPoints !== "number" ||
        !Number.isInteger(tiebreakData.opponentPoints) ||
        tiebreakData.opponentPoints < 0
      ) {
        throw new Error("tiebreak.opponentPoints must be a non-negative integer");
      }
      if (
        typeof tiebreakData.target !== "number" ||
        !Number.isInteger(tiebreakData.target) ||
        tiebreakData.target < 1
      ) {
        throw new Error("tiebreak.target must be a positive integer");
      }
      tiebreak = {
        trackedPlayerPoints: tiebreakData.trackedPlayerPoints,
        opponentPoints: tiebreakData.opponentPoints,
        target: tiebreakData.target,
      };
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
      tiebreak,
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
      tiebreak: this.tiebreak,
      winner: this.winner,
    };
  }
}
