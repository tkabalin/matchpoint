/**
 * Live scoring domain model — ScoreCheckpoint.
 *
 * A scoreboard the coach vouches for, appended to the match log like a Point. It is
 * what a coach records when they missed a game, a whole set, joined the match late, or
 * simply find the scoreboard wrong: rather than the app inventing the points that would
 * add up to 4-2, the coach states 4-2 and nothing is fabricated.
 *
 * Stores games and raw points only. Which sets are complete, who won them, whether a
 * breaker is running and whether the match is decided are all derived by `score.ts`'s
 * `interpretSnapshot`, so a stored snapshot can never contradict itself.
 *
 * The snapshot value types live here rather than in `score.ts` because they are this
 * record's own stored shape; `score.ts` imports them (and this class) one way.
 */

import type { Server } from "./point";
import { SERVERS } from "./point";

/** Raw points in one game: 0-3 for 0/15/30/40, 3-3 deuce, 4-3 advantage. */
export interface GamePoints {
  tracked: number;
  opponent: number;
}

export interface BreakerPoints {
  tracked: number;
  opponent: number;
}

export interface SetSnapshot {
  tracked: number;
  opponent: number;
  // Null when the set went to no breaker, or when its breaker score wasn't recorded.
  tiebreak: BreakerPoints | null;
}

export interface ScoreSnapshot {
  // Set 1 first, no gaps.
  sets: SetSnapshot[];
  // Null in a breaker, and once the match is decided.
  game: GamePoints | null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parsePair(value: unknown, what: string): { tracked: number; opponent: number } {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${what} must be an object`);
  }
  const data = value as Record<string, unknown>;
  if (!nonNegativeInteger(data.tracked) || !nonNegativeInteger(data.opponent)) {
    throw new Error(`${what} must hold two non-negative integers`);
  }
  return { tracked: data.tracked, opponent: data.opponent };
}

function parseSnapshot(value: unknown): ScoreSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("after must be an object");
  }
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.sets) || data.sets.length === 0) {
    throw new Error("after.sets must be a non-empty array");
  }
  const sets = (data.sets as unknown[]).map((raw, index) => {
    const pair = parsePair(raw, `after.sets[${String(index)}]`);
    const tiebreakValue = (raw as Record<string, unknown>).tiebreak;
    return {
      ...pair,
      tiebreak:
        tiebreakValue === null || tiebreakValue === undefined
          ? null
          : parsePair(tiebreakValue, `after.sets[${String(index)}].tiebreak`),
    };
  });
  return {
    sets,
    game: data.game === null || data.game === undefined ? null : parsePair(data.game, "after.game"),
  };
}

export class ScoreCheckpoint {
  readonly id: string;
  readonly matchId: string;
  readonly timestamp: number;
  // Shared with Point: one monotonic sequence space per match, never reused.
  readonly sequence: number;
  readonly after: ScoreSnapshot;
  // The coach's answer to "who serves next". A cross-check against the rotation, except
  // on an empty log (where it pins who served first) and when `orderChanged` is set.
  readonly servesNext: Server;
  // Set only through the score editor's explicit "the order changed on court" escape,
  // which ITF Rule 27c/d makes a real thing that happens: a completed out-of-turn game
  // permanently flips the rotation. Re-anchors the rotation rather than mutating Match.
  readonly orderChanged: boolean;

  private constructor(fields: {
    id: string;
    matchId: string;
    timestamp: number;
    sequence: number;
    after: ScoreSnapshot;
    servesNext: Server;
    orderChanged: boolean;
  }) {
    this.id = fields.id;
    this.matchId = fields.matchId;
    this.timestamp = fields.timestamp;
    this.sequence = fields.sequence;
    this.after = fields.after;
    this.servesNext = fields.servesNext;
    this.orderChanged = fields.orderChanged;
  }

  static create(input: unknown): ScoreCheckpoint {
    if (typeof input !== "object" || input === null) {
      throw new Error("checkpoint data must be an object");
    }
    const data = input as Record<string, unknown>;

    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new Error("checkpoint id must be a non-empty string");
    }
    if (typeof data.matchId !== "string" || data.matchId.length === 0) {
      throw new Error("checkpoint matchId must be a non-empty string");
    }
    if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp)) {
      throw new Error("checkpoint timestamp must be a finite number");
    }
    if (!nonNegativeInteger(data.sequence)) {
      throw new Error("checkpoint sequence must be a non-negative integer");
    }
    if (!SERVERS.includes(data.servesNext as Server)) {
      throw new Error(`invalid servesNext: ${String(data.servesNext)}`);
    }
    if (typeof data.orderChanged !== "boolean") {
      throw new Error("orderChanged must be a boolean");
    }

    return new ScoreCheckpoint({
      id: data.id,
      matchId: data.matchId,
      timestamp: data.timestamp,
      sequence: data.sequence,
      after: parseSnapshot(data.after),
      servesNext: data.servesNext as Server,
      orderChanged: data.orderChanged,
    });
  }

  static fromJSON(json: unknown): ScoreCheckpoint {
    return ScoreCheckpoint.create(json);
  }

  toJSON() {
    return {
      id: this.id,
      matchId: this.matchId,
      timestamp: this.timestamp,
      sequence: this.sequence,
      after: {
        sets: this.after.sets.map((set) => ({
          tracked: set.tracked,
          opponent: set.opponent,
          tiebreak: set.tiebreak === null ? null : { ...set.tiebreak },
        })),
        game: this.after.game === null ? null : { ...this.after.game },
      },
      servesNext: this.servesNext,
      orderChanged: this.orderChanged,
    };
  }
}
