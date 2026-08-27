/**
 * The score, folded from the match's own event log.
 *
 * A match record is an ordered log of two kinds of event: a `Point` (one point the
 * coach vouches for, at minimum its winner) and a `ScoreCheckpoint` (a scoreboard the
 * coach vouches for). Nothing is ever fabricated to bridge the two — a skipped span is
 * a checkpoint, never a run of invented points — and the score is a fold over that log
 * rather than a replay of a complete, contiguous `Point[]`.
 *
 * That is the whole reason this module exists. `state.ts` keeps the rule resolvers it
 * always had (`setRulesFor`, `isAdScoringFor`, `resolveGameWinner`, ...) and this
 * module composes them incrementally; the import only ever runs one way.
 *
 * The fold is total. A malformed snapshot or an event past a decided match is recorded
 * in `ignored` rather than thrown out of a render, because both are reachable from data
 * an older version of the app wrote.
 */

import type { Match } from "./match";
import { MatchSet } from "./match-set";
import type { TiebreakScore } from "./match-set";
import type { CourtSide, PointContext, Point, Server } from "./point";
import { ScoreCheckpoint } from "./checkpoint";
import type { BreakerPoints, GamePoints, ScoreSnapshot, SetSnapshot } from "./checkpoint";
import {
  isAdScoringFor,
  matchRulesFor,
  matchStateFor,
  maxSetsFor,
  pointCallFor,
  resolveGameWinner,
  setRulesFor,
} from "./state";
import type { SetRules } from "./state";

// --- Value types ------------------------------------------------------------------

// The snapshot a coach enters is the checkpoint's own stored shape, so it is defined
// beside the record that holds it and re-exported here, where the fold reads it.
export type { BreakerPoints, GamePoints, ScoreSnapshot, SetSnapshot } from "./checkpoint";

/** How much of a set (or of the whole match) was actually watched, not filled in. */
export type Observed = "full" | "partial" | "none";

export interface SetCoverage {
  // Game slots the set has consumed. A breaker is one slot, like any other game.
  slotsPlayed: number;
  // Of those, how many were completed by real points rather than declared.
  slotsObserved: number;
}

export interface CompletedSetEntry extends SetCoverage {
  set: MatchSet;
}

export interface LiveSet extends SetCoverage {
  setNumber: number;
  trackedGames: number;
  opponentGames: number;
  // Null until a breaker point is actually recorded, the same convention MatchSet uses.
  tiebreak: BreakerPoints | null;
  inBreaker: boolean;
}

export interface IgnoredEvent {
  sequence: number;
  reason: string;
}

export interface Scoreboard {
  completedSets: readonly CompletedSetEntry[];
  // Null only once the match is decided.
  currentSet: LiveSet | null;
  // Null in a breaker, and once the match is decided.
  game: GamePoints | null;
  matchWinner: Server | null;
  /**
   * Service rotation as an origin plus a count of the game slots consumed since it.
   * `firstServer` is simply the origin at slot 0; an `orderChanged` checkpoint moves
   * the origin rather than mutating `Match`, which is what makes a deviation on court
   * (ITF Rule 27c/d) recordable without a stale match row.
   */
  rotation: { origin: Server; slot: number };
  ignored: readonly IgnoredEvent[];
}

/** One refusal, naming the cell it belongs to so the editor can highlight it. */
export interface ScoreProblem {
  // "sets", "set:2", "set:2:tiebreak", "game" or "servesNext".
  cell: string;
  message: string;
}

export type MatchEvent = Point | ScoreCheckpoint;

// --- Small shared helpers -----------------------------------------------------------

export function otherServer(server: Server): Server {
  return server === "TRACKED" ? "OPPONENT" : "TRACKED";
}

function serverIdOf(match: Match, server: Server): string {
  return server === "TRACKED" ? match.trackedPlayerId : match.opponentId;
}

export function serverRoleOf(match: Match, id: string): Server {
  return id === match.trackedPlayerId ? "TRACKED" : "OPPONENT";
}

// Whether a set at this game score has entered (or, for the gamesToWin: 0 degenerate
// case, always is) the breaker — the single place the condition is computed.
function isTiebreakAt(tracked: number, opponent: number, rules: SetRules): boolean {
  if (rules.gamesToWin === 0) return true;
  return rules.tiebreakAt !== null && tracked === rules.tiebreakAt && opponent === rules.tiebreakAt;
}

// The set's winner on games alone — 7-6 is not decided here, since a breaker set is
// recorded by crediting the winner an extra game (see creditedBreakerWinner).
function gamesWinnerOf(tracked: number, opponent: number, rules: SetRules): Server | null {
  if (rules.gamesToWin === 0) return null;
  const lead = tracked - opponent;
  if (tracked >= rules.gamesToWin && lead >= 2) return "TRACKED";
  if (opponent >= rules.gamesToWin && -lead >= 2) return "OPPONENT";
  return null;
}

function breakerWinnerOf(points: BreakerPoints, target: number): Server | null {
  const lead = points.tracked - points.opponent;
  if (points.tracked >= target && lead >= 2) return "TRACKED";
  if (points.opponent >= target && -lead >= 2) return "OPPONENT";
  return null;
}

// A games score that records a breaker win: the winner is credited one game over the
// tiebreak threshold (7-6), tennis' own convention for how a breaker set is written.
function creditedBreakerWinner(tracked: number, opponent: number, rules: SetRules): Server | null {
  if (rules.tiebreakAt === null || rules.gamesToWin === 0) return null;
  const threshold = rules.tiebreakAt;
  if (tracked === threshold + 1 && opponent === threshold) return "TRACKED";
  if (opponent === threshold + 1 && tracked === threshold) return "OPPONENT";
  return null;
}

/**
 * Whether a score is reachable by playing forward from 0-0 without ever passing
 * through a position where play would already have stopped.
 *
 * One predicate over the win conditions rather than a per-system table of legal
 * scores: `short_sets` (breaker threshold below games-to-win) and `legacy`'s
 * unbounded decider then fall out for free, and the tables in the tests are the
 * expectations rather than the implementation.
 */
function isReachable(
  tracked: number,
  opponent: number,
  terminal: (tracked: number, opponent: number) => boolean,
): boolean {
  if (!Number.isInteger(tracked) || !Number.isInteger(opponent) || tracked < 0 || opponent < 0) {
    return false;
  }
  const grid: boolean[][] = [];
  for (let a = 0; a <= tracked; a += 1) {
    const row: boolean[] = [];
    for (let b = 0; b <= opponent; b += 1) {
      if (a === 0 && b === 0) {
        row.push(true);
        continue;
      }
      const fromLeft = a > 0 && (grid[a - 1]?.[b] ?? false) && !terminal(a - 1, b);
      const fromBelow = b > 0 && (row[b - 1] ?? false) && !terminal(a, b - 1);
      row.push(fromLeft || fromBelow);
    }
    grid.push(row);
  }
  return grid[tracked]?.[opponent] ?? false;
}

function gamesReachable(tracked: number, opponent: number, rules: SetRules): boolean {
  return isReachable(
    tracked,
    opponent,
    (a, b) => gamesWinnerOf(a, b, rules) !== null || isTiebreakAt(a, b, rules),
  );
}

function breakerReachable(points: BreakerPoints, target: number): boolean {
  return isReachable(
    points.tracked,
    points.opponent,
    (a, b) => breakerWinnerOf({ tracked: a, opponent: b }, target) !== null,
  );
}

// How many rotation slots a set has consumed once complete: its games, which already
// include the one credited for a breaker. The exception is the match-tiebreak decider,
// which credits no game at all yet still consumes exactly one slot.
function slotsForCompletedSet(tracked: number, opponent: number, rules: SetRules): number {
  return rules.gamesToWin === 0 ? 1 : tracked + opponent;
}

export function observedOf(coverage: SetCoverage): Observed {
  if (coverage.slotsPlayed === 0 || coverage.slotsObserved >= coverage.slotsPlayed) return "full";
  return coverage.slotsObserved === 0 ? "none" : "partial";
}

/** Games watched against games played, the coverage figure the result screen shows. */
export function coverageOf(board: Scoreboard): SetCoverage {
  let slotsPlayed = 0;
  let slotsObserved = 0;
  for (const entry of [...board.completedSets, ...(board.currentSet ? [board.currentSet] : [])]) {
    slotsPlayed += entry.slotsPlayed;
    slotsObserved += entry.slotsObserved;
  }
  return { slotsPlayed, slotsObserved };
}

export function matchSetsOf(board: Scoreboard): MatchSet[] {
  return board.completedSets.map((entry) => entry.set);
}

// --- Building blocks ----------------------------------------------------------------

function rulesForSet(match: Match, setNumber: number): SetRules {
  return setRulesFor(match.scoringSystem, setNumber, maxSetsFor(match.scoringSystem));
}

function freshSet(match: Match, setNumber: number): LiveSet {
  const rules = rulesForSet(match, setNumber);
  return {
    setNumber,
    trackedGames: 0,
    opponentGames: 0,
    tiebreak: null,
    inBreaker: isTiebreakAt(0, 0, rules),
    slotsPlayed: 0,
    slotsObserved: 0,
  };
}

function completedSetEntry(
  match: Match,
  live: LiveSet,
  winner: Server,
  rules: SetRules,
): CompletedSetEntry {
  const tiebreak: TiebreakScore | null =
    live.tiebreak === null
      ? null
      : {
          trackedPlayerPoints: live.tiebreak.tracked,
          opponentPoints: live.tiebreak.opponent,
          target: rules.tiebreakTarget,
        };
  return {
    set: MatchSet.create({
      matchId: match.matchId,
      setNumber: live.setNumber,
      trackedPlayerId: match.trackedPlayerId,
      opponentId: match.opponentId,
      trackedPlayerGames: live.trackedGames,
      opponentGames: live.opponentGames,
      tiebreak,
      winner: serverIdOf(match, winner),
    }),
    slotsPlayed: live.slotsPlayed,
    slotsObserved: live.slotsObserved,
  };
}

/** The board a match starts from: set 1 at love-all, serving from the toss. */
export function initialBoard(match: Match): Scoreboard {
  const first = freshSet(match, 1);
  return {
    completedSets: [],
    currentSet: first,
    game: first.inBreaker ? null : { tracked: 0, opponent: 0 },
    matchWinner: null,
    rotation: { origin: serverRoleOf(match, match.firstServer), slot: 0 },
    ignored: [],
  };
}

// Closes `live` and opens whatever comes next — the next set, or nothing once the
// match is decided. The one place a set boundary is crossed.
function closeSet(match: Match, board: Scoreboard, live: LiveSet, winner: Server): Scoreboard {
  const rules = rulesForSet(match, live.setNumber);
  const completedSets = [...board.completedSets, completedSetEntry(match, live, winner, rules)];
  const matchRules = matchRulesFor(match.scoringSystem);
  const decided = matchStateFor(
    completedSets.map((entry) => entry.set),
    match.trackedPlayerId,
    match.opponentId,
    matchRules,
  ).winner;

  if (decided !== null || live.setNumber >= matchRules.maxSets) {
    return {
      ...board,
      completedSets,
      currentSet: null,
      game: null,
      matchWinner: decided === null ? null : serverRoleOf(match, decided),
    };
  }
  const next = freshSet(match, live.setNumber + 1);
  return {
    ...board,
    completedSets,
    currentSet: next,
    game: next.inBreaker ? null : { tracked: 0, opponent: 0 },
  };
}

/**
 * Applies one point to the board — the incremental step the whole fold is built from,
 * and the same step `contextFor` probes to work out the stamps.
 *
 * A point past a decided match leaves the board untouched: it is the caller's job to
 * notice (the fold records it as ignored), not this function's to throw mid-render.
 */
export function applyPoint(match: Match, board: Scoreboard, won: boolean): Scoreboard {
  const live = board.currentSet;
  if (live === null || board.matchWinner !== null) return board;

  const rules = rulesForSet(match, live.setNumber);

  if (live.inBreaker) {
    const before = live.tiebreak ?? { tracked: 0, opponent: 0 };
    const tiebreak: BreakerPoints = {
      tracked: before.tracked + (won ? 1 : 0),
      opponent: before.opponent + (won ? 0 : 1),
    };
    const breakerWinner = breakerWinnerOf(tiebreak, rules.tiebreakTarget);
    if (breakerWinner === null) {
      return { ...board, currentSet: { ...live, tiebreak } };
    }
    // A breaker set credits its winner one game over the threshold (7-6); the
    // match-tiebreak decider has no games phase to credit from and stays 0-0.
    const credited = rules.gamesToWin === 0 ? 0 : 1;
    const closing: LiveSet = {
      ...live,
      tiebreak,
      trackedGames: live.trackedGames + (breakerWinner === "TRACKED" ? credited : 0),
      opponentGames: live.opponentGames + (breakerWinner === "OPPONENT" ? credited : 0),
      slotsPlayed: live.slotsPlayed + 1,
      slotsObserved: live.slotsObserved + 1,
    };
    return closeSet(
      match,
      { ...board, rotation: { ...board.rotation, slot: board.rotation.slot + 1 } },
      closing,
      breakerWinner,
    );
  }

  const before = board.game ?? { tracked: 0, opponent: 0 };
  const game: GamePoints = {
    tracked: before.tracked + (won ? 1 : 0),
    opponent: before.opponent + (won ? 0 : 1),
  };
  const gameWinner = resolveGameWinner<Server>(
    game.tracked,
    game.opponent,
    "TRACKED",
    "OPPONENT",
    isAdScoringFor(match.scoringSystem),
  );
  if (gameWinner === null) {
    return { ...board, game };
  }

  const played: LiveSet = {
    ...live,
    trackedGames: live.trackedGames + (gameWinner === "TRACKED" ? 1 : 0),
    opponentGames: live.opponentGames + (gameWinner === "OPPONENT" ? 1 : 0),
    slotsPlayed: live.slotsPlayed + 1,
    slotsObserved: live.slotsObserved + 1,
  };
  const advanced: Scoreboard = {
    ...board,
    rotation: { ...board.rotation, slot: board.rotation.slot + 1 },
  };

  const setWinner = gamesWinnerOf(played.trackedGames, played.opponentGames, rules);
  if (setWinner !== null) {
    return closeSet(match, advanced, played, setWinner);
  }
  const entersBreaker = isTiebreakAt(played.trackedGames, played.opponentGames, rules);
  return {
    ...advanced,
    currentSet: { ...played, inBreaker: entersBreaker },
    game: entersBreaker ? null : { tracked: 0, opponent: 0 },
  };
}

// --- Snapshots ----------------------------------------------------------------------

type SetReading =
  | { status: "complete"; winner: Server; slots: number }
  | { status: "in-progress"; inBreaker: boolean; slots: number };

// Reads one set of a snapshot against its own rules, or says which cell is wrong.
function readSet(
  snapshot: SetSnapshot,
  setNumber: number,
  rules: SetRules,
): { reading: SetReading } | { problems: ScoreProblem[] } {
  const cell = `set:${String(setNumber)}`;
  const { tracked, opponent, tiebreak } = snapshot;

  const counts = [tracked, opponent];
  if (counts.some((value) => !Number.isInteger(value) || value < 0 || value > 99)) {
    return { problems: [{ cell, message: "Games must be whole numbers from 0 to 99." }] };
  }
  if (tiebreak !== null) {
    const points = [tiebreak.tracked, tiebreak.opponent];
    if (points.some((value) => !Number.isInteger(value) || value < 0 || value > 99)) {
      return {
        problems: [{ cell: `${cell}:tiebreak`, message: "Tiebreak points must be whole numbers." }],
      };
    }
    if (!breakerReachable(tiebreak, rules.tiebreakTarget)) {
      return {
        problems: [
          {
            cell: `${cell}:tiebreak`,
            message: `That tiebreak score can't happen in a first to ${String(rules.tiebreakTarget)}.`,
          },
        ],
      };
    }
  }

  // The match-tiebreak decider is a breaker outright: no games phase to check.
  if (rules.gamesToWin === 0) {
    if (tracked !== 0 || opponent !== 0) {
      return { problems: [{ cell, message: "This set is a match tiebreak — it plays no games." }] };
    }
    const winner = tiebreak === null ? null : breakerWinnerOf(tiebreak, rules.tiebreakTarget);
    return winner === null
      ? { reading: { status: "in-progress", inBreaker: true, slots: 0 } }
      : { reading: { status: "complete", winner, slots: slotsForCompletedSet(0, 0, rules) } };
  }

  const credited = creditedBreakerWinner(tracked, opponent, rules);
  if (credited !== null) {
    if (!gamesReachable(rules.tiebreakAt ?? 0, rules.tiebreakAt ?? 0, rules)) {
      return { problems: [{ cell, message: "That set score can't happen." }] };
    }
    if (tiebreak !== null && breakerWinnerOf(tiebreak, rules.tiebreakTarget) !== credited) {
      return {
        problems: [
          {
            cell: `${cell}:tiebreak`,
            message: "The tiebreak score doesn't match who won the set.",
          },
        ],
      };
    }
    return {
      reading: {
        status: "complete",
        winner: credited,
        slots: slotsForCompletedSet(tracked, opponent, rules),
      },
    };
  }

  if (!gamesReachable(tracked, opponent, rules)) {
    return { problems: [{ cell, message: "That set score can't happen." }] };
  }

  const gamesWinner = gamesWinnerOf(tracked, opponent, rules);
  if (gamesWinner !== null) {
    if (tiebreak !== null) {
      return {
        problems: [
          { cell: `${cell}:tiebreak`, message: "This set was decided on games, not a tiebreak." },
        ],
      };
    }
    return {
      reading: {
        status: "complete",
        winner: gamesWinner,
        slots: slotsForCompletedSet(tracked, opponent, rules),
      },
    };
  }

  const inBreaker = isTiebreakAt(tracked, opponent, rules);
  if (!inBreaker && tiebreak !== null) {
    return {
      problems: [
        {
          cell: `${cell}:tiebreak`,
          message: `A tiebreak only starts at ${String(rules.tiebreakAt ?? 0)}-all.`,
        },
      ],
    };
  }
  if (inBreaker && tiebreak !== null && breakerWinnerOf(tiebreak, rules.tiebreakTarget) !== null) {
    // A decided breaker is a decided set, which the games cells must already show.
    return {
      problems: [
        {
          cell,
          message: "That tiebreak is over — record the set as won.",
        },
      ],
    };
  }
  return { reading: { status: "in-progress", inBreaker, slots: tracked + opponent } };
}

// The raw counts a game's call maps to, so two snapshots showing "40-30" fold
// identically: 0/15/30 are 0-2, deuce is 3-3, and an advantage is 4-3.
function isCanonicalGame(game: GamePoints, isAdScoring: boolean): boolean {
  const { tracked, opponent } = game;
  if (![tracked, opponent].every((value) => Number.isInteger(value) && value >= 0)) return false;
  if (resolveGameWinner(tracked, opponent, "TRACKED", "OPPONENT", isAdScoring) !== null) {
    return false;
  }
  if (tracked <= 3 && opponent <= 3) return true;
  // Past 40-40 only advantage remains, and only where the format plays it.
  return isAdScoring && Math.max(tracked, opponent) === 4 && Math.min(tracked, opponent) === 3;
}

/**
 * Turns a scoreboard the coach vouches for into a `Scoreboard`, or says which cells
 * are wrong. Everything beyond games and raw points is derived here: which sets are
 * complete and who won them, whether the last set is in a breaker, whether the match
 * is decided, and the rotation slot the next point sits on.
 *
 * Boundaries are normalised rather than refused: a complete last set that doesn't
 * decide the match becomes a completed set with the next one at love-all.
 */
export function interpretSnapshot(
  match: Match,
  snapshot: ScoreSnapshot,
): { board: Scoreboard } | { problems: ScoreProblem[] } {
  const maxSets = maxSetsFor(match.scoringSystem);
  const matchRules = matchRulesFor(match.scoringSystem);
  const problems: ScoreProblem[] = [];

  if (!Array.isArray(snapshot.sets) || snapshot.sets.length === 0) {
    return { problems: [{ cell: "sets", message: "Enter at least one set." }] };
  }
  if (snapshot.sets.length > maxSets) {
    return {
      problems: [{ cell: "sets", message: `This format plays at most ${String(maxSets)} sets.` }],
    };
  }

  const completedSets: CompletedSetEntry[] = [];
  let currentSet: LiveSet | null = null;
  let slot = 0;

  for (const [index, setSnapshot] of snapshot.sets.entries()) {
    const setNumber = index + 1;
    const rules = rulesForSet(match, setNumber);
    const read = readSet(setSnapshot, setNumber, rules);
    if ("problems" in read) {
      problems.push(...read.problems);
      continue;
    }
    const isLast = index === snapshot.sets.length - 1;
    const { reading } = read;

    // The match cannot already have been decided before this set was played, whether it
    // is finished or still running.
    const decidedBefore = matchStateFor(
      completedSets.map((entry) => entry.set),
      match.trackedPlayerId,
      match.opponentId,
      matchRules,
    ).winner;
    if (decidedBefore !== null) {
      problems.push({
        cell: `set:${String(setNumber)}`,
        message: "The match was already won before this set.",
      });
      continue;
    }

    if (reading.status === "in-progress") {
      if (!isLast) {
        problems.push({
          cell: `set:${String(setNumber)}`,
          message: "Only the last set can still be in progress.",
        });
        continue;
      }
      currentSet = {
        setNumber,
        trackedGames: setSnapshot.tracked,
        opponentGames: setSnapshot.opponent,
        tiebreak: setSnapshot.tiebreak,
        inBreaker: reading.inBreaker,
        slotsPlayed: reading.slots,
        slotsObserved: 0,
      };
      slot += reading.slots;
      continue;
    }

    completedSets.push(
      completedSetEntry(
        match,
        {
          setNumber,
          trackedGames: setSnapshot.tracked,
          opponentGames: setSnapshot.opponent,
          tiebreak: setSnapshot.tiebreak,
          inBreaker: false,
          slotsPlayed: reading.slots,
          slotsObserved: 0,
        },
        reading.winner,
        rules,
      ),
    );
    slot += reading.slots;
  }

  if (problems.length > 0) return { problems };

  const decided = matchStateFor(
    completedSets.map((entry) => entry.set),
    match.trackedPlayerId,
    match.opponentId,
    matchRules,
  ).winner;
  const matchWinner = decided === null ? null : serverRoleOf(match, decided);

  // A complete last set that doesn't decide the match opens the next one at love-all,
  // so a board is never left with nowhere to record the next point.
  if (currentSet === null && matchWinner === null) {
    if (completedSets.length >= maxSets) {
      return {
        problems: [{ cell: "sets", message: "That score can't decide this match." }],
      };
    }
    currentSet = freshSet(match, completedSets.length + 1);
  }

  const isAdScoring = isAdScoringFor(match.scoringSystem);
  let game: GamePoints | null = null;
  if (currentSet === null || currentSet.inBreaker) {
    if (snapshot.game !== null) {
      return {
        problems: [
          {
            cell: "game",
            message:
              currentSet === null
                ? "The match is over — there's no game in progress."
                : "A tiebreak is in progress — record its points instead.",
          },
        ],
      };
    }
  } else {
    game = snapshot.game ?? { tracked: 0, opponent: 0 };
    if (!isCanonicalGame(game, isAdScoring)) {
      return { problems: [{ cell: "game", message: "That game score can't happen." }] };
    }
  }

  return {
    board: {
      completedSets,
      currentSet,
      game,
      matchWinner,
      rotation: { origin: serverRoleOf(match, match.firstServer), slot },
      ignored: [],
    },
  };
}

/** The snapshot a board is already showing — what the score editor opens pre-filled. */
export function snapshotOf(board: Scoreboard): ScoreSnapshot {
  const sets: SetSnapshot[] = board.completedSets.map((entry) => ({
    tracked: entry.set.trackedPlayerGames,
    opponent: entry.set.opponentGames,
    tiebreak:
      entry.set.tiebreak === null
        ? null
        : {
            tracked: entry.set.tiebreak.trackedPlayerPoints,
            opponent: entry.set.tiebreak.opponentPoints,
          },
  }));
  if (board.currentSet !== null) {
    sets.push({
      tracked: board.currentSet.trackedGames,
      opponent: board.currentSet.opponentGames,
      tiebreak: board.currentSet.tiebreak,
    });
  }
  return { sets, game: board.game === null ? null : { ...board.game } };
}

// --- Rotation and court side ---------------------------------------------------------

// The origin serves slot 0, and serve alternates every slot after it.
function serverForSlot(rotation: Scoreboard["rotation"], slot: number): Server {
  return slot % 2 === 0 ? rotation.origin : otherServer(rotation.origin);
}

/**
 * Who serves the next point.
 *
 * Outside a breaker that is one alternation off the rotation origin. Inside one,
 * rotation is local: whoever would have served that game slot serves point 1 alone,
 * then serve alternates every 2 points — `floor(pointNumber / 2) % 2 === 0` is that
 * pattern's closed form.
 */
export function nextServerFor(board: Scoreboard): Server {
  const live = board.currentSet;
  const slotServer = serverForSlot(board.rotation, board.rotation.slot);
  if (live === null || !live.inBreaker) return slotServer;

  const played = live.tiebreak === null ? 0 : live.tiebreak.tracked + live.tiebreak.opponent;
  const firstServerServesNext = Math.floor((played + 1) / 2) % 2 === 0;
  return firstServerServesNext ? slotServer : otherServer(slotServer);
}

/**
 * Which physical side the next point is played from — deuce on an even count of points
 * played so far, ad on an odd one, unconditional through extended deuce and identical
 * inside a breaker (position still alternates by points played).
 */
export function nextCourtSideFor(board: Scoreboard): CourtSide {
  const live = board.currentSet;
  let played = 0;
  if (live !== null && live.inBreaker) {
    played = live.tiebreak === null ? 0 : live.tiebreak.tracked + live.tiebreak.opponent;
  } else if (board.game !== null) {
    played = board.game.tracked + board.game.opponent;
  }
  return played % 2 === 0 ? "DEUCE" : "AD";
}

/**
 * The origin that makes `servesNext` true of this snapshot — how the first checkpoint
 * on an empty log pins who served first, which is the only moment `firstServer` can
 * still be decided (see §3.6 of the capture-flexibility design).
 */
export function firstServerImpliedBy(board: Scoreboard, servesNext: Server): Server {
  const asTracked: Scoreboard = {
    ...board,
    rotation: { origin: "TRACKED", slot: board.rotation.slot },
  };
  return nextServerFor(asTracked) === servesNext ? "TRACKED" : "OPPONENT";
}

// --- Checkpoints ----------------------------------------------------------------------

/**
 * Whether this checkpoint can be applied to this board, and if not, which cells are
 * wrong. Everything the snapshot says about itself is checked by `interpretSnapshot`;
 * what is left is what only the board can answer — that the score actually changes,
 * and that "serving next" agrees with the rotation.
 */
export function validateCheckpoint(
  match: Match,
  board: Scoreboard,
  checkpoint: ScoreCheckpoint,
  { hasEvents }: { hasEvents: boolean },
): ScoreProblem[] {
  const read = interpretSnapshot(match, checkpoint.after);
  if ("problems" in read) return read.problems;

  // On an empty log the answer defines the rotation rather than being checked against
  // it, and an explicit "the order changed on court" re-anchors it (ITF Rule 27c/d).
  if (!hasEvents || checkpoint.orderChanged) return [];

  // Checked before the no-op rule below, so that recording a deviation on court — which
  // changes the rotation and nothing else — reaches its own refusal and the escape that
  // answers it, rather than being turned away as a score that changes nothing.
  //
  // Against the board's own origin, not `firstServer`: an earlier order change moved
  // it, and the cross-check has to speak about the rotation in force.
  const would = nextServerFor({
    ...read.board,
    rotation: { origin: board.rotation.origin, slot: read.board.rotation.slot },
  });
  if (would !== checkpoint.servesNext) {
    const names = { TRACKED: "the player", OPPONENT: "the opponent" };
    return [
      {
        cell: "servesNext",
        message: `With this score, ${names[would]} would be serving next. Either the games are off, or the serving order changed on court.`,
      },
    ];
  }

  const current = snapshotOf(board);
  if (JSON.stringify(current) === JSON.stringify(checkpoint.after)) {
    return [{ cell: "sets", message: "That's already the score." }];
  }
  return [];
}

/**
 * Applies a checkpoint to the board. Games the coach declared rather than watched
 * never count as observed, so a correction can only ever lower coverage, never raise it.
 */
export function applyCheckpoint(
  match: Match,
  board: Scoreboard,
  checkpoint: ScoreCheckpoint,
): { board: Scoreboard } | { problems: ScoreProblem[] } {
  const read = interpretSnapshot(match, checkpoint.after);
  if ("problems" in read) return read;

  const previous = [...board.completedSets, ...(board.currentSet ? [board.currentSet] : [])];
  const keepObserved = <T extends SetCoverage>(entry: T, index: number): T => ({
    ...entry,
    slotsObserved: Math.min(previous[index]?.slotsObserved ?? 0, entry.slotsPlayed),
  });

  const next: Scoreboard = {
    ...read.board,
    completedSets: read.board.completedSets.map(keepObserved),
    currentSet:
      read.board.currentSet === null
        ? null
        : keepObserved(read.board.currentSet, read.board.completedSets.length),
    ignored: board.ignored,
  };

  if (checkpoint.orderChanged) {
    // The deviation is recorded as a new origin rather than a mutation of `Match`, so
    // a queued match row can never disagree with the log about who served first.
    const origin = firstServerImpliedBy(next, checkpoint.servesNext);
    return { board: { ...next, rotation: { origin, slot: next.rotation.slot } } };
  }
  return { board: { ...next, rotation: { ...next.rotation, origin: board.rotation.origin } } };
}

// --- The fold --------------------------------------------------------------------------

export function isCheckpoint(event: MatchEvent): event is ScoreCheckpoint {
  return event instanceof ScoreCheckpoint;
}

/**
 * The score after every event in the log, in order.
 *
 * Total by design: an event that can't be applied — out of order, past a decided
 * match, or a snapshot an older version of the app wrote and this one refuses — is
 * recorded in `ignored` and skipped, never thrown out of a render.
 */
export function foldScore(match: Match, events: readonly MatchEvent[]): Scoreboard {
  let board = initialBoard(match);
  const ignored: IgnoredEvent[] = [];
  let lastSequence = -Infinity;

  for (const event of events) {
    if (event.matchId !== match.matchId) {
      ignored.push({ sequence: event.sequence, reason: "belongs to another match" });
      continue;
    }
    if (event.sequence < lastSequence) {
      ignored.push({ sequence: event.sequence, reason: "out of sequence order" });
      continue;
    }
    lastSequence = event.sequence;

    if (isCheckpoint(event)) {
      const applied = applyCheckpoint(match, board, event);
      if ("problems" in applied) {
        ignored.push({
          sequence: event.sequence,
          reason: applied.problems[0]?.message ?? "invalid",
        });
        continue;
      }
      board = applied.board;
      continue;
    }

    if (board.matchWinner !== null) {
      ignored.push({ sequence: event.sequence, reason: "the match was already decided" });
      continue;
    }
    board = applyPoint(match, board, event.won);
  }

  return { ...board, ignored };
}

// --- Stamps ----------------------------------------------------------------------------

function endedGame(before: Scoreboard, after: Scoreboard): boolean {
  if (after.completedSets.length > before.completedSets.length) return true;
  const from = before.currentSet;
  const to = after.currentSet;
  if (from === null || to === null) return false;
  return to.slotsPlayed > from.slotsPlayed;
}

function endedSet(before: Scoreboard, after: Scoreboard): boolean {
  return after.completedSets.length > before.completedSets.length;
}

/**
 * The nine stamps, computed by asking the fold what each outcome would do rather than
 * by a second copy of the rules: "is this a game point" is "would the server winning
 * end the game". Both flags are true at no-ad deuce, and inside a breaker the same
 * probes answer for the breaker as the game slot it occupies.
 */
export function contextFor(
  match: Match,
  board: Scoreboard,
  server: Server,
  won: boolean,
): PointContext {
  const live = board.currentSet;
  const afterServerWins = applyPoint(match, board, server === "TRACKED");
  const afterReceiverWins = applyPoint(match, board, server !== "TRACKED");
  const actual = applyPoint(match, board, won);

  return {
    setNumber: live?.setNumber ?? board.completedSets.length,
    // A breaker is a game number of its own, which is what counting slots gives.
    gameNumber: (live?.slotsPlayed ?? 0) + 1,
    inTiebreak: live?.inBreaker ?? false,
    isGamePoint: endedGame(board, afterServerWins),
    isBreakPoint: endedGame(board, afterReceiverWins),
    isSetPoint: endedSet(board, afterServerWins) || endedSet(board, afterReceiverWins),
    isMatchPoint: afterServerWins.matchWinner !== null || afterReceiverWins.matchWinner !== null,
    isGameEnd: endedGame(board, actual),
    isSetEnd: endedSet(board, actual),
  };
}

// --- Display ----------------------------------------------------------------------------

export interface ScoreboardRows {
  trackedPlayer: string[];
  opponent: string[];
  // Parallel to the two rows: how much of the set that column belongs to was actually
  // watched, and null for the current game's call, which belongs to no set. Built here
  // rather than re-derived by the header, so the columns and their coverage cannot
  // drift apart.
  observed: (Observed | null)[];
}

/**
 * The live score in the two-row, one-column-per-set shape a broadcast scoreboard uses:
 * a games column per set, then the current game's call — breaker points while one is
 * running, `pointCallFor`'s labels otherwise. A match-tiebreak decider plays no games,
 * so it shows its breaker score in brackets instead, per MatchSet's own convention.
 */
export function scoreboardFor(match: Match, board: Scoreboard): ScoreboardRows {
  const maxSets = maxSetsFor(match.scoringSystem);
  const trackedPlayer: string[] = [];
  const opponent: string[] = [];
  const observed: (Observed | null)[] = [];

  for (const entry of board.completedSets) {
    const rules = setRulesFor(match.scoringSystem, entry.set.setNumber, maxSets);
    if (rules.gamesToWin === 0 && entry.set.tiebreak !== null) {
      trackedPlayer.push(`[${String(entry.set.tiebreak.trackedPlayerPoints)}]`);
      opponent.push(`[${String(entry.set.tiebreak.opponentPoints)}]`);
    } else {
      trackedPlayer.push(String(entry.set.trackedPlayerGames));
      opponent.push(String(entry.set.opponentGames));
    }
    observed.push(observedOf(entry));
  }

  const live = board.currentSet;
  if (live === null) return { trackedPlayer, opponent, observed };

  const rules = setRulesFor(match.scoringSystem, live.setNumber, maxSets);
  if (rules.gamesToWin !== 0) {
    trackedPlayer.push(String(live.trackedGames));
    opponent.push(String(live.opponentGames));
    observed.push(observedOf(live));
  }

  if (live.inBreaker) {
    trackedPlayer.push(String(live.tiebreak?.tracked ?? 0));
    opponent.push(String(live.tiebreak?.opponent ?? 0));
  } else {
    const game = board.game ?? { tracked: 0, opponent: 0 };
    const call = pointCallFor(game.tracked, game.opponent, isAdScoringFor(match.scoringSystem));
    trackedPlayer.push(call.trackedPlayer);
    opponent.push(call.opponent);
  }
  observed.push(null);

  return { trackedPlayer, opponent, observed };
}
