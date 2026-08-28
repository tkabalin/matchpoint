/**
 * Generates a fake dataset in the shape capture actually produces.
 *
 * Nothing here invents a Point by hand: every point is built by driving the real
 * capture flow (`startPoint`/`transition`/`commitDraft`) with simulated taps, and the
 * score comes from the real fold, so a point that could not be captured on a phone
 * cannot come out of here either. The tennis itself is a coin-weighting model, not a
 * simulation of shot mechanics — realistic distributions, not realistic rallies.
 *
 * The CSVs it writes are committed; the JSON bundle beside them is the same data in
 * the log's own nested shape, and is gitignored — it is 20 MB and regenerates from
 * the seed.
 *
 * Run: pnpm --filter @matchpoint/web gen-fake-data [-- --seed 7 --players 12
 *      --matches 120 --out apps/web/scripts/fake-data]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startPoint, commitDraft, transition } from "../src/features/capture/capture-flow.ts";
import type { CaptureAction, CaptureState } from "../src/features/capture/capture-flow.ts";
import { ScoreCheckpoint } from "../src/features/capture/checkpoint.ts";
import { Match } from "../src/features/capture/match.ts";
import type { MatchEndReason, ScoringSystem, SurfaceType } from "../src/features/capture/match.ts";
import { Point } from "../src/features/capture/point.ts";
import type {
  CourtDepth,
  CourtSide,
  FailureMode,
  RallyBucket,
  ShotType,
  UnusualReason,
  Wing,
} from "../src/features/capture/point.ts";
import {
  applyCheckpoint,
  applyPoint,
  contextFor,
  coverageOf,
  foldScore,
  initialBoard,
  nextCourtSideFor,
  nextServerFor,
  snapshotOf,
  validateCheckpoint,
} from "../src/features/capture/score.ts";
import type { Scoreboard } from "../src/features/capture/score.ts";

// --- Configuration ---------------------------------------------------------------

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const SEED = Number(flag("seed", "7"));
const PLAYER_COUNT = Number(flag("players", "12"));
const MATCH_COUNT = Number(flag("matches", "120"));
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  flag("out", "apps/web/scripts/fake-data"),
);

// The season the matches are spread over, oldest first.
const SEASON_START = new Date(2025, 8, 6);
const SEASON_END = new Date(2026, 7, 22);

// --- Randomness ------------------------------------------------------------------
//
// Seeded throughout: the same seed must give the same dataset, or a bug found in one
// run cannot be looked at again in the next.

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);

function chance(probability: number): boolean {
  return rng() < probability;
}

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

/** Picks by relative weight — `[["a", 3], ["b", 1]]` returns "a" three times as often. */
function weighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function between(low: number, high: number): number {
  return low + rng() * (high - low);
}

function uuid(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let index = 0; index < 32; index++) {
    if (index === 12) out += "4";
    else if (index === 16) out += hex[8 + Math.floor(rng() * 4)];
    else out += hex[Math.floor(rng() * 16)];
    if (index === 7 || index === 11 || index === 15 || index === 19) out += "-";
  }
  return out;
}

/** Stable 0-1 from a string, so an opponent's strength is the same in every match. */
function hashUnit(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

// --- People ----------------------------------------------------------------------

/**
 * What decides how a player's points fall out. `rally` is the only relative figure —
 * a point between two players is weighted by the gap between theirs — while the serve
 * numbers are absolute rates.
 */
interface Skill {
  rally: number;
  firstServeIn: number;
  secondServeIn: number;
  aceRate: number;
  aggression: number;
}

interface RosterPlayer {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  date_of_birth: string;
  dominant_hand: "right" | "left";
  gender: "male" | "female" | "other";
  notes: string | null;
  coach_id: string;
  photo_url: null;
  created_at: string;
  updated_at: string;
  has_transfer_code: boolean;
  /** Not an API field — the generator's own knob, kept so a run can be explained. */
  skill: Skill;
}

const FIRST_NAMES = [
  "Thabo",
  "Aisha",
  "Liam",
  "Nomsa",
  "Ravi",
  "Chloe",
  "Sipho",
  "Hannah",
  "Yusuf",
  "Zanele",
  "Daniel",
  "Priya",
  "Kagiso",
  "Emma",
  "Tendai",
  "Jonas",
  "Lerato",
  "Sarah",
  "Marco",
  "Naledi",
];

const LAST_NAMES = [
  "Mokoena",
  "Petersen",
  "van Wyk",
  "Dlamini",
  "Naidoo",
  "Botha",
  "Khumalo",
  "Fourie",
  "Abrahams",
  "Nkosi",
  "Steyn",
  "Reddy",
  "Mahlangu",
  "Louw",
  "Chikwanda",
  "de Villiers",
  "Molefe",
  "Adams",
  "Ferreira",
  "Sithole",
];

const PLAYER_NOTES = [
  "Strong forehand, avoids the backhand under pressure.",
  "Second serve is the weak link — sits up on big points.",
  "Best mover in the squad; wins the long ones.",
  "Rushes between points when behind.",
  "Net game is well ahead of the baseline game.",
  null,
  null,
];

const COACH_ID = uuid();

function makeSkill(): Skill {
  return {
    rally: between(0.3, 0.75),
    firstServeIn: between(0.52, 0.7),
    secondServeIn: between(0.85, 0.96),
    aceRate: between(0.02, 0.12),
    aggression: between(0.25, 0.8),
  };
}

function makeRoster(count: number): RosterPlayer[] {
  const players: RosterPlayer[] = [];
  const used = new Set<string>();
  while (players.length < count) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    if (used.has(name)) continue;
    used.add(name);
    const birthYear = 2000 + Math.floor(rng() * 12);
    const created = new Date(2025, 7, 1 + Math.floor(rng() * 30));
    players.push({
      id: uuid(),
      first_name: first,
      last_name: last,
      username: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}${String(
        10 + Math.floor(rng() * 89),
      )}`,
      date_of_birth: isoDate(
        new Date(birthYear, Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)),
      ),
      dominant_hand: chance(0.15) ? "left" : "right",
      gender: weighted([
        ["male", 5],
        ["female", 5],
        ["other", 1],
      ] as const),
      notes: pick(PLAYER_NOTES),
      coach_id: COACH_ID,
      photo_url: null,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
      has_transfer_code: chance(0.2),
      skill: makeSkill(),
    });
  }
  return players;
}

const OPPONENT_NAMES = [
  "S. Kruger",
  "P. Moodley",
  "D. Gouws",
  "A. Tshabalala",
  "B. Hendricks",
  "C. Weber",
  "F. Okonkwo",
  "G. Landman",
  "I. Smit",
  "J. Pillay",
  "N. Radebe",
  "O. Brand",
  "T. Naidoo",
  "M. Coetzee",
  "K. Zulu",
  "R. Jacobs",
  "L. Meyer",
  "V. Pretorius",
  "H. Maree",
  "E. Mabaso",
  "W. Bezuidenhout",
  "Q. Ndlovu",
  "Z. Isaacs",
  "U. Mthembu",
];

/** An unrostered opponent has no profile to read, so their strength comes off their name. */
function opponentSkill(name: string): Skill {
  const seed = hashUnit(name);
  return {
    rally: 0.3 + seed * 0.45,
    firstServeIn: 0.52 + hashUnit(`${name}:first`) * 0.18,
    secondServeIn: 0.85 + hashUnit(`${name}:second`) * 0.11,
    aceRate: 0.02 + hashUnit(`${name}:ace`) * 0.1,
    aggression: 0.25 + hashUnit(`${name}:agg`) * 0.55,
  };
}

// --- How much the coach saw --------------------------------------------------------

/**
 * A coach watching a match is not a camera: some serves, endings and whole games go
 * unrecorded. Each match draws one of these, so the gaps cluster the way they really
 * do rather than sprinkling evenly across every match.
 */
interface Attention {
  label: "close" | "typical" | "light";
  missServe: number;
  missEnding: number;
  missShot: number;
  missBall: number;
  rallyLength: number;
  skipPoint: number;
  checkpoint: number;
  note: number;
}

const ATTENTION: readonly (readonly [Attention, number])[] = [
  [
    {
      label: "close",
      missServe: 0.01,
      missEnding: 0.01,
      missShot: 0.02,
      missBall: 0.03,
      rallyLength: 0.96,
      skipPoint: 0.004,
      checkpoint: 0.004,
      note: 0.006,
    },
    35,
  ],
  [
    {
      label: "typical",
      missServe: 0.05,
      missEnding: 0.04,
      missShot: 0.09,
      missBall: 0.11,
      rallyLength: 0.85,
      skipPoint: 0.02,
      checkpoint: 0.02,
      note: 0.01,
    },
    45,
  ],
  [
    {
      label: "light",
      missServe: 0.16,
      missEnding: 0.14,
      missShot: 0.24,
      missBall: 0.28,
      rallyLength: 0.6,
      skipPoint: 0.06,
      checkpoint: 0.06,
      note: 0.014,
    },
    20,
  ],
];

const COACH_NOTES = [
  "Second serve sitting up again",
  "Feet stopped on that one",
  "Good aggressive return",
  "Rushing between points",
  "Nice change of pace",
  "Backhand breaking down under pressure",
  "Called for a let, disputed it",
  "Dropped shoulder on the forehand",
  "Best point of the match",
  "Talk about court positioning after this game",
];

// --- One point ---------------------------------------------------------------------

const SHOT_TYPES_BY_AGGRESSION: readonly (readonly [ShotType, number])[] = [
  ["DRIVE", 62],
  ["VOLLEY", 20],
  ["DROPSHOT", 10],
  ["LOB", 8],
];

const UNUSUAL_REASONS: readonly (readonly [UnusualReason, number])[] = [
  ["NET_TOUCH", 4],
  ["BALL_HIT_PLAYER", 3],
  ["REACHED_OVER", 1],
  ["DOUBLE_HIT", 2],
  ["HINDRANCE", 4],
  ["POINT_PENALTY", 1],
  ["OTHER", 2],
];

function failureMode(): FailureMode {
  return weighted([
    ["NET", 5],
    ["LONG", 3],
    ["WIDE", 3],
  ] as const);
}

function rallyBucket(): RallyBucket {
  return weighted([
    ["B1", 44],
    ["B2", 30],
    ["B3", 16],
    ["B4", 10],
  ] as const);
}

function courtZone(): { half: CourtSide; depth: CourtDepth } {
  return {
    half: chance(0.5) ? "DEUCE" : "AD",
    depth: weighted([
      ["DEEP", 7],
      ["SHORT", 3],
    ] as const),
  };
}

/**
 * How often the server wins a point that reached a rally, from the skill gap.
 *
 * The gap is scaled down hard on purpose: a game is best-of-many points, so a point
 * edge compounds. At a straight skill difference the strongest player in the squad
 * would bagel the weakest in every meeting, and a season of 6-0 6-0 is not data
 * anybody would recognise.
 */
function serverRallyEdge(server: Skill, receiver: Skill, onFirstServe: boolean): number {
  const gap = (server.rally - receiver.rally) * 0.18;
  const base = onFirstServe ? 0.56 : 0.49;
  return Math.min(0.75, Math.max(0.25, base + gap));
}

/** The tracked player's share of all points, both serves averaged — what a skipped span is played out on. */
function trackedPointShare(tracked: Skill, opponent: Skill): number {
  return (
    (serverRallyEdge(tracked, opponent, true) + 1 - serverRallyEdge(opponent, tracked, true)) / 2
  );
}

/** One day's form, so the same pairing doesn't produce the same match twice. */
function onTheDay(skill: Skill): Skill {
  return { ...skill, rally: Math.min(1, Math.max(0, skill.rally + between(-0.05, 0.05))) };
}

/**
 * Builds one point by feeding the flow the taps a coach would have made, then commits
 * it. Returns null when the flow aborted, which nothing here does today but which the
 * caller must not assume away.
 */
function capturePoint(
  match: Match,
  board: Scoreboard,
  sequence: number,
  timestamp: number,
  tracked: Skill,
  opponent: Skill,
  attention: Attention,
): Point {
  const server = nextServerFor(board);
  const courtSide = nextCourtSideFor(board);
  let state = startPoint(match.matchId, sequence, server, courtSide);

  const serverSkill = server === "TRACKED" ? tracked : opponent;
  const receiverSkill = server === "TRACKED" ? opponent : tracked;
  const trackedServing = server === "TRACKED";

  const act = (action: CaptureAction) => {
    state = transition(state, action);
  };

  // The header's note button, which is valid on any step and doesn't advance the flow.
  if (chance(attention.note)) act({ type: "ADD_NOTE", text: pick(COACH_NOTES) });

  // The header's skip: winner only, everything else left unseen.
  if (chance(attention.skipPoint)) {
    const won = chance(
      trackedServing
        ? serverRallyEdge(tracked, opponent, true)
        : 1 - serverRallyEdge(opponent, tracked, true),
    );
    act({ type: "TAP_UNUSUAL" });
    act({ type: "TAP_UNUSUAL_OUTCOME", won });
    act({ type: "TAP_UNUSUAL_REASON", reason: null, note: null });
    return finish(state, match, board, sequence, timestamp);
  }

  let onFirstServe = true;

  if (chance(attention.missServe)) {
    // Nothing is recorded for the serve at all — the coach looked up mid-rally.
    act({ type: "TAP_DIDNT_SEE" });
  } else {
    const firstIn = chance(serverSkill.firstServeIn);
    if (firstIn && chance(serverSkill.aceRate)) {
      act({ type: "TAP_SERVE_ACE" });
      return finish(state, match, board, sequence, timestamp);
    }
    if (!firstIn) {
      onFirstServe = false;
      act(
        trackedServing
          ? { type: "TAP_SERVE_FAULT", location: failureMode() }
          : { type: "TAP_SERVE_FAULT" },
      );
      const secondIn = chance(serverSkill.secondServeIn);
      if (!secondIn) {
        act(
          trackedServing
            ? { type: "TAP_SERVE_FAULT", location: failureMode() }
            : { type: "TAP_SERVE_FAULT" },
        );
        return finish(state, match, board, sequence, timestamp);
      }
      if (chance(serverSkill.aceRate * 0.25)) {
        act({ type: "TAP_SERVE_ACE" });
        return finish(state, match, board, sequence, timestamp);
      }
    }

    if (trackedServing) {
      act({ type: "TAP_SERVE_IN" });
    } else {
      // Returning: the miss is the tracked player's own, and its placement is the
      // whole record of it, so the flow ends the point there.
      const missRate = onFirstServe ? 0.19 : 0.11;
      if (chance(missRate)) {
        act({
          type: "TAP_RETURN",
          outcome: failureMode(),
          endReason: chance(onFirstServe ? 0.55 : 0.3) ? "FORCED" : "MISTAKE",
        });
        return finish(state, match, board, sequence, timestamp);
      }
      act({ type: "TAP_RETURN", outcome: "IN" });
    }
  }

  // The rally screen asks two questions and only advances once both are answered, so a
  // coach who never judged the length has one way off it: "didn't see" the ending.
  const recordsLength = chance(attention.rallyLength);
  if (recordsLength) act({ type: "TAP_RALLY_LENGTH", bucket: rallyBucket() });

  const serverWins = chance(serverRallyEdge(serverSkill, receiverSkill, onFirstServe));
  const won = trackedServing ? serverWins : !serverWins;

  if (chance(0.008)) {
    act({ type: "TAP_UNUSUAL" });
    act({ type: "TAP_UNUSUAL_OUTCOME", won });
    const reason = weighted(UNUSUAL_REASONS);
    act({
      type: "TAP_UNUSUAL_REASON",
      reason,
      note: reason === "OTHER" ? "Ball from the next court" : null,
    });
    return finish(state, match, board, sequence, timestamp);
  }

  if (!recordsLength || chance(attention.missEnding)) {
    act({ type: "TAP_DIDNT_SEE", won });
    return finish(state, match, board, sequence, timestamp);
  }

  // Longer rallies end in a mistake more often than a ball nobody could reach.
  const winnerAggression = won ? tracked.aggression : opponent.aggression;
  const endReason = chance(0.34 + winnerAggression * 0.3) ? "FORCED" : "MISTAKE";
  act({ type: "TAP_RALLY_OUTCOME", won, endReason });

  if (endReason === "FORCED") {
    if (chance(attention.missShot)) {
      act({ type: "TAP_DIDNT_SEE" });
    } else {
      const wing: Wing = chance(0.62) ? "FOREHAND" : "BACKHAND";
      act({ type: "TAP_SHOT_DETAIL", wing, shotType: weighted(SHOT_TYPES_BY_AGGRESSION) });
    }
  }

  if (chance(attention.missBall)) {
    act({ type: "TAP_DIDNT_SEE" });
  } else {
    // Always in: capture records where the last ball to land finished, never where a
    // miss went (see point.ts's own comment on ballIn).
    act({ type: "TAP_BALL_LOCATION", ballIn: true, location: courtZone() });
  }

  return finish(state, match, board, sequence, timestamp);
}

/** Answers the rally-length step off the draft, then commits — live-match's `advance`. */
function finish(
  state: CaptureState,
  match: Match,
  board: Scoreboard,
  sequence: number,
  timestamp: number,
): Point {
  let final = state;
  if (final.step.name === "RALLY_LENGTH") {
    final = transition(final, {
      type: "TAP_RALLY_LENGTH",
      bucket: final.draft.rallyLengthBucket,
    });
  }
  if (final.step.name !== "READY") {
    throw new Error(`point ${String(sequence)} ended on step ${final.step.name}, not READY`);
  }
  const won = final.draft.won ?? false;
  const context = contextFor(match, board, final.draft.server, won);
  return commitDraft(final.draft, uuid(), timestamp, context);
}

// --- One match -----------------------------------------------------------------------

interface LoggedEventRow {
  id: string;
  matchId: string;
  coachId: string;
  sequence: number;
  kind: "point" | "checkpoint";
  payload: unknown;
}

interface GeneratedMatch {
  match: ReturnType<Match["toJSON"]>;
  /** The row live-match queues when the coach ends the match. */
  outcome: { reason: MatchEndReason | "completed"; trackedPlayerWon: boolean };
  events: LoggedEventRow[];
  /** Derived from the events, not captured — carried so a row can be read at a glance. */
  summary: {
    trackedPlayerName: string;
    opponentDisplayName: string;
    scoreline: string;
    attention: Attention["label"];
    points: number;
    checkpoints: number;
    gamesPlayed: number;
    gamesWatched: number;
  };
}

const SCORING_SYSTEMS: readonly (readonly [ScoringSystem, number])[] = [
  ["traditional", 58],
  ["no_ad_scoring", 14],
  ["short_sets", 9],
  ["match_tiebreak_10_points", 9],
  ["pro_set", 6],
  ["mens_grand_slam", 3],
  ["legacy", 1],
];

const SURFACES: readonly (readonly [SurfaceType, number])[] = [
  ["hard", 55],
  ["clay", 22],
  ["grass", 6],
  ["carpet", 3],
  ["unspecified", 14],
];

function slotsOf(board: Scoreboard): number {
  const completed = board.completedSets.reduce((sum, entry) => sum + entry.slotsPlayed, 0);
  return completed + (board.currentSet?.slotsPlayed ?? 0);
}

/** Plays `slots` game slots forward on a copy of the board, recording nothing. */
function playForward(match: Match, board: Scoreboard, slots: number, edge: number): Scoreboard {
  let shadow = board;
  const target = slotsOf(board) + slots;
  let guard = 0;
  while (slotsOf(shadow) < target && shadow.matchWinner === null && guard < 400) {
    shadow = applyPoint(match, shadow, chance(edge));
    guard += 1;
  }
  return shadow;
}

function scorelineOf(match: Match, board: Scoreboard): string {
  const parts = board.completedSets.map((entry) => {
    const set = entry.set;
    const games = `${String(set.trackedPlayerGames)}-${String(set.opponentGames)}`;
    if (set.tiebreak === null) return games;
    const loser = Math.min(set.tiebreak.trackedPlayerPoints, set.tiebreak.opponentPoints);
    return `${games}(${String(loser)})`;
  });
  const live = board.currentSet;
  if (live !== null && (live.trackedGames > 0 || live.opponentGames > 0)) {
    parts.push(`${String(live.trackedGames)}-${String(live.opponentGames)}`);
  }
  return parts.join(" ") || "0-0";
}

function generateMatch(
  player: RosterPlayer,
  opponent: { id: string; name: string | null; display: string; skill: Skill },
  playedOn: string,
): GeneratedMatch {
  const attention = weighted(ATTENTION);
  const scoringSystem = weighted(SCORING_SYSTEMS);
  const trackedServesFirst = chance(0.5);
  const opponentId = opponent.id;

  let match = Match.create({
    matchId: uuid(),
    playedOn,
    trackedPlayerId: player.id,
    opponentId,
    opponentName: opponent.name,
    scoringSystem,
    firstServer: trackedServesFirst ? player.id : opponentId,
    surfaceType: weighted(SURFACES),
    outcomeOverride: null,
  });

  const events: LoggedEventRow[] = [];
  const eventObjects: (Point | ScoreCheckpoint)[] = [];
  let board = initialBoard(match);
  let sequence = 0;
  let timestamp =
    new Date(`${playedOn}T09:15:00.000Z`).getTime() + Math.floor(rng() * 6 * 3600_000);

  // A walkover never reaches the court, so it has no events at all.
  if (chance(0.012)) {
    const trackedPlayerWon = chance(0.5);
    match = Match.create({
      ...match.toJSON(),
      outcomeOverride: {
        reason: "walkover",
        winner: trackedPlayerWon ? player.id : opponentId,
      },
    });
    return {
      match: match.toJSON(),
      outcome: { reason: "walkover", trackedPlayerWon },
      events,
      summary: {
        trackedPlayerName: `${player.first_name} ${player.last_name}`,
        opponentDisplayName: opponent.display,
        scoreline: "walkover",
        attention: attention.label,
        points: 0,
        checkpoints: 0,
        gamesPlayed: 0,
        gamesWatched: 0,
      },
    };
  }

  // A retirement stops the capture partway; drawn up front so the loop knows when.
  const retiresAfter = chance(0.03) ? 30 + Math.floor(rng() * 60) : null;
  const playerForm = onTheDay(player.skill);
  const opponentForm = onTheDay(opponent.skill);
  const trackedEdge = trackedPointShare(playerForm, opponentForm);

  let guard = 0;
  while (board.matchWinner === null && guard < 900) {
    guard += 1;

    if (retiresAfter !== null && events.length >= retiresAfter) break;

    const point = capturePoint(
      match,
      board,
      sequence,
      timestamp,
      playerForm,
      opponentForm,
      attention,
    );
    events.push({
      id: point.id,
      matchId: match.matchId,
      coachId: COACH_ID,
      sequence,
      kind: "point",
      payload: point.toJSON(),
    });
    eventObjects.push(point);
    board = applyPoint(match, board, point.won);
    sequence += 1;
    timestamp += 20_000 + Math.floor(rng() * 45_000);

    // Between games is where a coach loses the thread: they come back, see the score,
    // and state it rather than have the app invent the points they missed.
    if (point.context.isGameEnd && board.matchWinner === null && chance(attention.checkpoint)) {
      const shadow = playForward(match, board, 1 + Math.floor(rng() * 3), trackedEdge);
      const draft = {
        after: snapshotOf(shadow),
        servesNext: nextServerFor(shadow),
        orderChanged: false,
      };
      const problems = validateCheckpoint(match, board, draft, { hasEvents: true });
      if (problems.length === 0) {
        const checkpoint = ScoreCheckpoint.create({
          id: uuid(),
          matchId: match.matchId,
          timestamp,
          sequence,
          ...draft,
        });
        const applied = applyCheckpoint(match, board, checkpoint);
        if (!("problems" in applied)) {
          events.push({
            id: checkpoint.id,
            matchId: match.matchId,
            coachId: COACH_ID,
            sequence,
            kind: "checkpoint",
            payload: checkpoint.toJSON(),
          });
          eventObjects.push(checkpoint);
          board = applied.board;
          sequence += 1;
          timestamp += 60_000 + Math.floor(rng() * 240_000);
        }
      }
    }
  }

  // The fold is the app's own reading of the log; the incremental board must agree
  // with it, or the dataset says one thing and the app would show another.
  const folded = foldScore(match, eventObjects);
  if (folded.ignored.length > 0) {
    throw new Error(
      `match ${match.matchId} logged ${String(folded.ignored.length)} ignored events`,
    );
  }

  let reason: MatchEndReason | "completed" = "completed";
  let trackedPlayerWon = folded.matchWinner === "TRACKED";
  if (folded.matchWinner === null) {
    // Whoever was still standing takes it; the coach's own answer in the end-match sheet.
    reason = "retirement";
    trackedPlayerWon = chance(0.5);
    match = Match.create({
      ...match.toJSON(),
      outcomeOverride: {
        reason: "retirement",
        winner: trackedPlayerWon ? player.id : opponentId,
      },
    });
  }

  const coverage = coverageOf(folded);
  return {
    match: match.toJSON(),
    outcome: { reason, trackedPlayerWon },
    events,
    summary: {
      trackedPlayerName: `${player.first_name} ${player.last_name}`,
      opponentDisplayName: opponent.display,
      scoreline: scorelineOf(match, folded),
      attention: attention.label,
      points: events.filter((event) => event.kind === "point").length,
      checkpoints: events.filter((event) => event.kind === "checkpoint").length,
      gamesPlayed: coverage.slotsPlayed,
      gamesWatched: coverage.slotsObserved,
    },
  };
}

// --- CSV ------------------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(header: readonly string[], rows: readonly unknown[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n";
}

const MATCH_COLUMNS = [
  "match_id",
  "played_on",
  "tracked_player_id",
  "tracked_player_name",
  "opponent_id",
  "opponent_name",
  "scoring_system",
  "surface_type",
  "first_server",
  "outcome_reason",
  "tracked_player_won",
  "scoreline",
  "points_captured",
  "checkpoints",
  "games_played",
  "games_watched",
  "coach_attention",
];

const POINT_COLUMNS = [
  "match_id",
  "played_on",
  "tracked_player_id",
  "opponent_id",
  "point_id",
  "sequence",
  "timestamp",
  "server",
  "court_side",
  "won",
  "set_number",
  "game_number",
  "in_tiebreak",
  "is_break_point",
  "is_game_point",
  "is_game_end",
  "is_set_point",
  "is_set_end",
  "is_match_point",
  "serve1_outcome",
  "serve1_location",
  "serve2_outcome",
  "serve2_location",
  "return_outcome",
  "end_reason",
  "unusual_reason",
  "unusual_note",
  "note",
  "wing",
  "shot_type",
  "ball_in",
  "ball_zone_half",
  "ball_zone_depth",
  "ball_failure_mode",
  "rally_length_bucket",
];

const CHECKPOINT_COLUMNS = [
  "match_id",
  "checkpoint_id",
  "sequence",
  "timestamp",
  "serves_next",
  "order_changed",
  "sets",
  "game",
];

function pointRow(generated: GeneratedMatch, payload: ReturnType<Point["toJSON"]>): unknown[] {
  const zone = payload.ballLocation;
  const isZone = zone !== null && typeof zone === "object";
  return [
    generated.match.matchId,
    generated.match.playedOn,
    generated.match.trackedPlayerId,
    generated.match.opponentId,
    payload.id,
    payload.sequence,
    new Date(payload.timestamp).toISOString(),
    payload.server,
    payload.courtSide,
    payload.won,
    payload.context.setNumber,
    payload.context.gameNumber,
    payload.context.inTiebreak,
    payload.context.isBreakPoint,
    payload.context.isGamePoint,
    payload.context.isGameEnd,
    payload.context.isSetPoint,
    payload.context.isSetEnd,
    payload.context.isMatchPoint,
    payload.serves[0]?.outcome ?? null,
    payload.serves[0]?.location ?? null,
    payload.serves[1]?.outcome ?? null,
    payload.serves[1]?.location ?? null,
    payload.returnOutcome,
    payload.endReason,
    payload.unusualReason,
    payload.unusualNote,
    payload.note,
    payload.wing,
    payload.shotType,
    payload.ballIn,
    isZone ? zone.half : null,
    isZone ? zone.depth : null,
    isZone ? null : zone,
    payload.rallyLengthBucket,
  ];
}

// --- Run -------------------------------------------------------------------------------

const players = makeRoster(PLAYER_COUNT);
const matches: GeneratedMatch[] = [];

const seasonDays = Math.round((SEASON_END.getTime() - SEASON_START.getTime()) / 86_400_000);

for (let index = 0; index < MATCH_COUNT; index++) {
  const player = players[index % players.length]!;
  const playedOn = isoDate(
    new Date(SEASON_START.getTime() + Math.floor(rng() * seasonDays) * 86_400_000),
  );

  // Most opponents are free text; a few are squad-mates playing each other.
  const intraSquad = chance(0.15);
  const mate = players.filter((other) => other.id !== player.id)[
    Math.floor(rng() * (players.length - 1))
  ]!;
  const name = pick(OPPONENT_NAMES);
  const opponent = intraSquad
    ? {
        id: mate.id,
        name: null,
        display: `${mate.first_name} ${mate.last_name}`,
        skill: mate.skill,
      }
    : { id: uuid(), name, display: name, skill: opponentSkill(name) };

  matches.push(generateMatch(player, opponent, playedOn));
}

matches.sort((left, right) => left.match.playedOn.localeCompare(right.match.playedOn));

mkdirSync(OUT_DIR, { recursive: true });

const bundle = {
  generator: "apps/web/scripts/generate-fake-data.ts",
  seed: SEED,
  coachId: COACH_ID,
  /** Every payload below is a `toJSON()` from the capture model, unchanged. */
  players,
  matches,
};

writeFileSync(resolve(OUT_DIR, "capture-data.json"), JSON.stringify(bundle, null, 2));

writeFileSync(
  resolve(OUT_DIR, "matches.csv"),
  csv(
    MATCH_COLUMNS,
    matches.map((generated) => [
      generated.match.matchId,
      generated.match.playedOn,
      generated.match.trackedPlayerId,
      generated.summary.trackedPlayerName,
      generated.match.opponentId,
      generated.match.opponentName ?? generated.summary.opponentDisplayName,
      generated.match.scoringSystem,
      generated.match.surfaceType,
      generated.match.firstServer,
      generated.outcome.reason,
      generated.outcome.trackedPlayerWon,
      generated.summary.scoreline,
      generated.summary.points,
      generated.summary.checkpoints,
      generated.summary.gamesPlayed,
      generated.summary.gamesWatched,
      generated.summary.attention,
    ]),
  ),
);

const pointRows: unknown[][] = [];
const checkpointRows: unknown[][] = [];
for (const generated of matches) {
  for (const event of generated.events) {
    if (event.kind === "point") {
      pointRows.push(pointRow(generated, event.payload as ReturnType<Point["toJSON"]>));
      continue;
    }
    const payload = event.payload as ReturnType<ScoreCheckpoint["toJSON"]>;
    checkpointRows.push([
      generated.match.matchId,
      payload.id,
      payload.sequence,
      new Date(payload.timestamp).toISOString(),
      payload.servesNext,
      payload.orderChanged,
      payload.after.sets
        .map(
          (set) =>
            `${String(set.tracked)}-${String(set.opponent)}` +
            (set.tiebreak === null
              ? ""
              : `(${String(set.tiebreak.tracked)}-${String(set.tiebreak.opponent)})`),
        )
        .join(" "),
      payload.after.game === null
        ? ""
        : `${String(payload.after.game.tracked)}-${String(payload.after.game.opponent)}`,
    ]);
  }
}

writeFileSync(resolve(OUT_DIR, "points.csv"), csv(POINT_COLUMNS, pointRows));
writeFileSync(resolve(OUT_DIR, "checkpoints.csv"), csv(CHECKPOINT_COLUMNS, checkpointRows));

writeFileSync(
  resolve(OUT_DIR, "players.csv"),
  csv(
    [
      "player_id",
      "first_name",
      "last_name",
      "username",
      "date_of_birth",
      "dominant_hand",
      "gender",
      "coach_id",
      "notes",
    ],
    players.map((player) => [
      player.id,
      player.first_name,
      player.last_name,
      player.username,
      player.date_of_birth,
      player.dominant_hand,
      player.gender,
      player.coach_id,
      player.notes,
    ]),
  ),
);

writeFileSync(
  resolve(OUT_DIR, "README.md"),
  [
    "# Fake capture data",
    "",
    `Generated by \`apps/web/scripts/generate-fake-data.ts\` with seed ${String(SEED)}. Nothing here`,
    "is real: the players, the opponents and every point are simulated. The same seed regenerates",
    "the same files.",
    "",
    "| File | What it holds |",
    "| --- | --- |",
    "| `players.csv` | The roster. |",
    "| `matches.csv` | One row per match, with the derived scoreline and how much of it was watched. |",
    "| `points.csv` | One row per captured point, every field flattened. |",
    "| `checkpoints.csv` | One row per score checkpoint (a scoreboard the coach declared). |",
    "",
    "A `capture-data.json` sits here too after a run, holding the same data in the match log's own",
    "nested shape: a `Match.toJSON()` per match, then its ordered events, each one a `Point.toJSON()`",
    "or a `ScoreCheckpoint.toJSON()` exactly as the device stores them. It is gitignored for its size.",
    "",
    "## Reading a point",
    "",
    "A point's score fields (`won`, `server`, `court_side`, and the nine `context` stamps) are always",
    "set. Its observation fields are nullable and empty means *the coach didn't see it*, not zero:",
    "no serve outcome is a serve nobody watched, no `end_reason` is an ending nobody watched. Serve",
    "placement is only ever recorded for the tracked player's own faults, and `ball_in` is always",
    "true, because capture records where the last ball to land finished, never where a miss went.",
    "",
    "## Regenerating",
    "",
    "```sh",
    "pnpm --filter @matchpoint/web gen-fake-data -- --seed 7 --players 12 --matches 120",
    "```",
    "",
  ].join("\n"),
);

const totalPoints = pointRows.length;
const wins = matches.filter((generated) => generated.outcome.trackedPlayerWon).length;
process.stdout.write(
  [
    `seed ${String(SEED)} -> ${OUT_DIR}`,
    `${String(players.length)} players, ${String(matches.length)} matches (${String(wins)} won by the tracked player)`,
    `${String(totalPoints)} points, ${String(checkpointRows.length)} score checkpoints`,
    "",
  ].join("\n"),
);
