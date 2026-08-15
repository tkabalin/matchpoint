/**
 * Live scoring domain model — Match.
 *
 * Sits at the top of Point → Game → Set → Match. `scoringSystem` is decided once
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

// The named format a coach picks at match setup. Started out as two separate
// concepts — this named preset (`ScoringSystem`) plus a `ScoringRules` bag of
// the concrete rule values it implies (ad scoring, tiebreak-at, ...) — but
// `ScoringRules` never grew any fields, so they were merged into just this
// enum. Whatever value lands here is fixed for the whole match — Match decides
// it once, Set and Game only ever read it, never redefine it (see module doc
// comment above).
export type ScoringSystem =
  | "traditional"
  | "mens_grand_slam"
  | "womens_grand_slam"
  | "no_ad_scoring"
  | "match_tiebreak_10_points"
  | "short_sets"
  | "pro_set"
  | "legacy";
export const SCORING_SYSTEMS: readonly ScoringSystem[] = [
  "traditional",
  "mens_grand_slam",
  "womens_grand_slam",
  "no_ad_scoring",
  "match_tiebreak_10_points",
  "short_sets",
  "pro_set",
  "legacy",
];

// TODO: not built yet — fields TBD (set score, games, tiebreak, ...). Named
// `MatchSet` rather than `Set` because `Set` is already the built-in JS/TS
// collection type; reusing that name here would shadow it for this whole module.
export interface MatchSet {}

/**
 * `id` and `trackedPlayerId`/`opponentId` follow Point's convention: `trackedPlayerId`
 * always comes from a real `Player` row, `opponentId` does too when the opponent is
 * identifiable, and stands in for the backend's free-text `Match.opponent_name`
 * otherwise (see `point.ts` and `apps/api/src/matchpoint_api/models/match.py`).
 */
export class Match {
  readonly matchId: string;
  // ISO 8601 — year, month, day and time the match was played.
  readonly timestamp: string;
  readonly trackedPlayerId: string;
  readonly opponentId: string;
  readonly scoringSystem: ScoringSystem;
  readonly firstServer: FirstServer;
  readonly surfaceType: SurfaceType;
  readonly sets: readonly MatchSet[];

  // Takes an already-validated, already-copied `sets` array — Match.create is the
  // only caller, and it's the one responsible for defensively copying it, same as
  // Point does for trackedPlayerShots/opponentShots (see point.ts). Without that,
  // `readonly` here only stops reassignment, not `.push(...)` on the array itself.
  private constructor(fields: {
    matchId: string;
    timestamp: string;
    trackedPlayerId: string;
    opponentId: string;
    scoringSystem: ScoringSystem;
    firstServer: FirstServer;
    surfaceType: SurfaceType;
    sets: readonly MatchSet[];
  }) {
    this.matchId = fields.matchId;
    this.timestamp = fields.timestamp;
    this.trackedPlayerId = fields.trackedPlayerId;
    this.opponentId = fields.opponentId;
    this.scoringSystem = fields.scoringSystem;
    this.firstServer = fields.firstServer;
    this.surfaceType = fields.surfaceType;
    this.sets = fields.sets;
  }

  //______________________________________Not sure if we will use this, but it is a good idea to have a factory method for creating a Match from untrusted input.
  // TODO: rough first pass at structural checks, matching Point.create's approach —
  // revisit once the outbox/sync layer settles on how untrusted this input really is.
  static create(input: unknown): Match {
    if (typeof input !== "object" || input === null) {
      throw new Error("match data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.matchId !== "string" || data.matchId.length === 0) {
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
    if (!SCORING_SYSTEMS.includes(data.scoringSystem as ScoringSystem)) {
      throw new Error(`invalid scoringSystem: ${String(data.scoringSystem)}`);
    }
    if (!FIRST_SERVERS.includes(data.firstServer as FirstServer)) {
      throw new Error(`invalid firstServer: ${String(data.firstServer)}`);
    }
    if (!SURFACE_TYPES.includes(data.surfaceType as SurfaceType)) {
      throw new Error(`invalid surfaceType: ${String(data.surfaceType)}`);
    }
    if (!Array.isArray(data.sets)) {
      throw new Error("sets must be an array");
    }
    // Copied, not the caller's array: otherwise mutating it after Match.create()
    // returns would silently mutate this "already-validated" Match too.
    const sets = [...(data.sets as MatchSet[])];

    return new Match({
      matchId: data.matchId,
      timestamp: data.timestamp,
      trackedPlayerId: data.trackedPlayerId,
      opponentId: data.opponentId,
      scoringSystem: data.scoringSystem as ScoringSystem,
      firstServer: data.firstServer as FirstServer,
      surfaceType: data.surfaceType as SurfaceType,
      sets,
    });
  }
}

/**
 * Creates a new Match, generating a fresh matchId.
 *
 * Beyond `Match.create`'s own field validation, this also derives `sets`'s
 * starting length from `scoringSystem` — see the switch below. Field validation
 * itself (non-empty ids, valid enum members, etc.) still happens in
 * `Match.create`, same as for any other caller.
 */
export function createMatch(
  timestamp: string,
  trackedPlayerId: string,
  opponentId: string,
  scoringSystem: ScoringSystem,
  surfaceType: SurfaceType,
  firstServer: FirstServer,
): Match {
  // The most sets a match of this format can run to — a match can finish
  // earlier (e.g. a straight-sets win), so this is a ceiling, not a prediction.
  // TODO: confirm against the brief/BBD once set/game rules are firmed up —
  // "traditional" and "legacy" are placeholder assumptions (best-of-3) for now.
  let maxSets: number;
  switch (scoringSystem) {
    case "mens_grand_slam":
      maxSets = 5;
      break;
    case "pro_set":
      maxSets = 1;
      break;
    case "traditional":
    case "womens_grand_slam":
    case "no_ad_scoring":
    case "match_tiebreak_10_points":
    case "short_sets":
    case "legacy":
      maxSets = 3;
      break;
    default: {
      // Exhaustiveness check: a new ScoringSystem member with no case above
      // fails to compile here instead of silently falling through.
      const unhandled: never = scoringSystem;
      throw new Error(`unhandled scoringSystem: ${String(unhandled)}`);
    }
  }
  const sets: MatchSet[] = Array.from({ length: maxSets }, () => ({}));

  return Match.create({
    matchId: crypto.randomUUID(),
    timestamp,
    trackedPlayerId,
    opponentId,
    scoringSystem,
    firstServer,
    surfaceType,
    sets,
  });
}
