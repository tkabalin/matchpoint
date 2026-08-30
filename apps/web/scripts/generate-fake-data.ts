/**
 * Generates a fake dataset in the shape capture actually produces.
 *
 * Nothing here invents a Point by hand: every point is built by driving the real
 * capture flow (`startPoint`/`transition`/`commitDraft`) with simulated taps, and the
 * score comes from the real fold, so a point that could not be captured on a phone
 * cannot come out of here either. The tennis itself is a coin-weighting model, not a
 * simulation of shot mechanics — realistic distributions, not realistic rallies.
 *
 * Two sets of CSVs come out: the capture model's own columns, and `import/`, the four
 * files `apps/api/scripts/import_sample_data.py` reads. The second is why no point here
 * leaves its serve, its ending or its final ball unrecorded — `PointCreate` takes those
 * columns non-null, so a coach's gap there is a point the demo could not import.
 *
 * The CSVs it writes are committed; the JSON bundle beside them is the same data in
 * the log's own nested shape, and is gitignored — it is 20 MB and regenerates from
 * the seed.
 *
 * Run: pnpm --filter @matchpoint/web gen-fake-data [-- --seed 13 --players 12
 *      --matches 120 --out apps/web/scripts/fake-data]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PointCreate } from "@matchpoint/api-client";
import { zPointCreate } from "@matchpoint/api-client/zod";

import { startPoint, commitDraft, transition } from "../src/features/capture/capture-flow.ts";
import type { CaptureAction, CaptureState } from "../src/features/capture/capture-flow.ts";
import { Match } from "../src/features/capture/match.ts";
import type { MatchEndReason, ScoringSystem, SurfaceType } from "../src/features/capture/match.ts";
import { Point } from "../src/features/capture/point.ts";
import type {
  CourtDepth,
  CourtSide,
  EndReason,
  FailureMode,
  RallyBucket,
  ReturnOutcome,
  Server,
  ServeOutcome,
  ShotType,
  UnusualReason,
  Wing,
} from "../src/features/capture/point.ts";
import {
  applyPoint,
  contextFor,
  coverageOf,
  foldScore,
  initialBoard,
  nextCourtSideFor,
  nextServerFor,
} from "../src/features/capture/score.ts";
import type { Scoreboard } from "../src/features/capture/score.ts";

// --- Configuration ---------------------------------------------------------------

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

// 13 rather than any other: the squad lands at 61 wins of 120 with no unbeaten and no
// winless player, so the ranking screens have a spread to rank on.
const SEED = Number(flag("seed", "13"));
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

/** Thousands separators by hand: toLocaleString would read the environment's locale. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

interface DemoCoach {
  id: string;
  email: string;
  displayName: string;
}

/**
 * The roster is split between these, so a demo can show a coach seeing only their own
 * players. The importer keys a coach on the email and gives every one it creates the
 * same password; example.com is reserved, so no demo account can reach a real inbox.
 */
const COACHES: readonly DemoCoach[] = [
  { id: uuid(), email: "thandi.mokoena@example.com", displayName: "Thandi Mokoena" },
  { id: uuid(), email: "derek.wallace@example.com", displayName: "Derek Wallace" },
  { id: uuid(), email: "farah.ismail@example.com", displayName: "Farah Ismail" },
];

const COACH_BY_ID = new Map(COACHES.map((coach) => [coach.id, coach]));

/** The email the importer joins a player's rows on — their coach's. */
function emailOf(player: RosterPlayer): string {
  return COACH_BY_ID.get(player.coach_id)!.email;
}

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
      // Round-robin rather than random, so no coach draws an empty roster.
      coach_id: COACHES[players.length % COACHES.length]!.id,
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

interface Opponent {
  id: string;
  /** Null for a squad-mate, whose name the match reads off their own profile. */
  name: string | null;
  display: string;
  skill: Skill;
}

/**
 * How many opponents one player meets across a season. Drawing every match fresh from
 * the 24 names above gave almost every pairing a single match, and opponent performance
 * is a deliverable: at four, ten matches a season leave a record worth reading.
 */
const CIRCUIT_SIZE = 4;

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

/** The opponents one player meets this season, one of them a squad-mate under their coach. */
function circuitFor(player: RosterPlayer, squad: readonly RosterPlayer[]): Opponent[] {
  const circuit: Opponent[] = [];
  const mates = squad.filter(
    (other) => other.id !== player.id && other.coach_id === player.coach_id,
  );
  if (mates.length > 0) {
    const mate = pick(mates);
    circuit.push({
      id: mate.id,
      name: null,
      display: `${mate.first_name} ${mate.last_name}`,
      skill: mate.skill,
    });
  }
  const used = new Set<string>();
  while (circuit.length < CIRCUIT_SIZE) {
    const name = pick(OPPONENT_NAMES);
    if (used.has(name)) continue;
    used.add(name);
    circuit.push({ id: uuid(), name, display: name, skill: opponentSkill(name) });
  }
  return circuit;
}

// --- How much the coach saw --------------------------------------------------------

/**
 * A coach watching a match is not a camera: the shot that ended a point often goes
 * unrecorded. Each match draws one of these, so the gaps cluster the way they really do
 * rather than sprinkling evenly across every match. It is only the shot detail because
 * every other gap capture allows is a column the API takes non-null.
 */
interface Attention {
  label: "close" | "typical" | "light";
  missShot: number;
  note: number;
}

const ATTENTION: readonly (readonly [Attention, number])[] = [
  [{ label: "close", missShot: 0.02, note: 0.006 }, 35],
  [{ label: "typical", missShot: 0.09, note: 0.01 }, 45],
  [{ label: "light", missShot: 0.24, note: 0.014 }, 20],
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

  let onFirstServe = true;

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

  // Settled before the point is played out: a missed return is one of the ways the
  // receiver loses a point on this serve, not a second one stacked on the rally — the
  // server's edge already prices the returns nobody puts back.
  const serverWins = chance(serverRallyEdge(serverSkill, receiverSkill, onFirstServe));
  const won = trackedServing ? serverWins : !serverWins;

  if (trackedServing) {
    act({ type: "TAP_SERVE_IN" });
  } else {
    // Returning: the miss is the tracked player's own, and its placement is the
    // whole record of it, so the flow ends the point there.
    const missShare = onFirstServe ? 0.34 : 0.22;
    if (!won && chance(missShare)) {
      act({
        type: "TAP_RETURN",
        outcome: failureMode(),
        endReason: chance(onFirstServe ? 0.55 : 0.3) ? "FORCED" : "MISTAKE",
      });
      return finish(state, match, board, sequence, timestamp);
    }
    act({ type: "TAP_RETURN", outcome: "IN" });
  }

  // The rally screen only advances once both its questions are answered, and the one
  // way off it without judging the length is "didn't see" the ending — which is the
  // ending the API cannot store, so the length is always judged here.
  act({ type: "TAP_RALLY_LENGTH", bucket: rallyBucket() });

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

  // Always in: capture records where the last ball to land finished, never where a
  // miss went (see point.ts's own comment on ballIn).
  act({ type: "TAP_BALL_LOCATION", ballIn: true, location: courtZone() });

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

/** The row live-match queues for each committed point, as the outbox stores it. */
interface LoggedPointRow {
  id: string;
  matchId: string;
  coachId: string;
  sequence: number;
  payload: ReturnType<Point["toJSON"]>;
}

interface GeneratedMatch {
  match: ReturnType<Match["toJSON"]>;
  /** The row live-match queues when the coach ends the match. */
  outcome: { reason: MatchEndReason | "completed"; trackedPlayerWon: boolean };
  points: LoggedPointRow[];
  /** Derived from the points, not captured — carried so a row can be read at a glance. */
  summary: {
    trackedPlayerName: string;
    opponentDisplayName: string;
    scoreline: string;
    attention: Attention["label"];
    gamesPlayed: number;
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

/** How likely the tracked player is to be given a match that stopped early, from the board. */
function retirementOdds(match: Match, board: Scoreboard): number {
  // Sets first, then the set in progress. `winner` rather than the game counts, which a
  // match-tiebreak set leaves at 0-0 (see match-set.ts).
  const sets = board.completedSets.reduce(
    (lead, entry) => lead + (entry.set.winner === match.trackedPlayerId ? 1 : -1),
    0,
  );
  const live = board.currentSet;
  const lead =
    sets !== 0 ? sets : Math.sign((live?.trackedGames ?? 0) - (live?.opponentGames ?? 0));
  if (lead === 0) return 0.5;
  return lead > 0 ? 0.85 : 0.15;
}

function scorelineOf(board: Scoreboard): string {
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

  const captured: Point[] = [];
  let board = initialBoard(match);
  let sequence = 0;
  let timestamp =
    new Date(`${playedOn}T09:15:00.000Z`).getTime() + Math.floor(rng() * 6 * 3600_000);

  const playerForm = onTheDay(player.skill);
  const opponentForm = onTheDay(opponent.skill);

  // A walkover never reaches the court, so it has no points at all. Nobody played, so
  // there is no board to read a winner off and the day's form is the only signal there
  // is; no scoreline is shown against it either way.
  if (chance(0.012)) {
    const trackedPlayerWon = chance(
      Math.min(0.8, Math.max(0.2, 0.5 + (playerForm.rally - opponentForm.rally))),
    );
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
      points: [],
      summary: {
        trackedPlayerName: `${player.first_name} ${player.last_name}`,
        opponentDisplayName: opponent.display,
        scoreline: "walkover",
        attention: attention.label,
        gamesPlayed: 0,
      },
    };
  }

  // A retirement stops the capture partway; drawn up front so the loop knows when.
  const retiresAfter = chance(0.03) ? 30 + Math.floor(rng() * 60) : null;

  let guard = 0;
  while (board.matchWinner === null && guard < 900) {
    guard += 1;

    if (retiresAfter !== null && captured.length >= retiresAfter) break;

    const point = capturePoint(
      match,
      board,
      sequence,
      timestamp,
      playerForm,
      opponentForm,
      attention,
    );
    captured.push(point);
    board = applyPoint(match, board, point.won);
    sequence += 1;
    timestamp += 20_000 + Math.floor(rng() * 45_000);
  }

  // The fold is the app's own reading of the log; the incremental board must agree
  // with it, or the dataset says one thing and the app would show another.
  const folded = foldScore(match, captured);
  if (folded.ignored.length > 0) {
    throw new Error(
      `match ${match.matchId} logged ${String(folded.ignored.length)} ignored events`,
    );
  }

  let reason: MatchEndReason | "completed" = "completed";
  let trackedPlayerWon = folded.matchWinner === "TRACKED";
  if (folded.matchWinner === null) {
    // Whoever was still standing takes it; the coach's own answer in the end-match sheet.
    // Weighted by the board, since the player who stops is usually the one already
    // losing: a retirement recorded against whoever led reads as a bug in the match list.
    reason = "retirement";
    trackedPlayerWon = chance(retirementOdds(match, folded));
    match = Match.create({
      ...match.toJSON(),
      outcomeOverride: {
        reason: "retirement",
        winner: trackedPlayerWon ? player.id : opponentId,
      },
    });
  }

  return {
    match: match.toJSON(),
    outcome: { reason, trackedPlayerWon },
    points: captured.map((point) => ({
      id: point.id,
      matchId: match.matchId,
      coachId: player.coach_id,
      sequence: point.sequence,
      payload: point.toJSON(),
    })),
    summary: {
      trackedPlayerName: `${player.first_name} ${player.last_name}`,
      opponentDisplayName: opponent.display,
      scoreline: scorelineOf(folded),
      attention: attention.label,
      gamesPlayed: coverageOf(folded).slotsPlayed,
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
  "games_played",
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

// --- The importer's own CSVs -------------------------------------------------------------
//
// `apps/api/scripts/import_sample_data.py` reads these four files and
// `apps/api/scripts/sample-data/README.md` is their spec: the same season under the API's
// column names and lower-case enum values, with a match_key standing in for the match id
// it never stores.

/**
 * The capture model's members against the API's, spelled out rather than lower-cased.
 * A Record over the capture union stops compiling the moment either side gains or
 * renames a member, where a `toLowerCase()` would carry the divergence into the CSV and
 * fail mid-import on whoever is running it — the same guarantee the sync layer's payload
 * mapping gets from its annotated return type (see sync/match-payload.ts).
 */
type ApiPoint = Omit<PointCreate, "id">;

const API_SERVER: Record<Server, ApiPoint["server"]> = {
  TRACKED: "tracked",
  OPPONENT: "opponent",
};

const API_SERVE_OUTCOME: Record<ServeOutcome, ApiPoint["serve1_outcome"]> = {
  IN: "in",
  FAULT: "fault",
  ACE: "ace",
};

const API_COURT_SIDE: Record<CourtSide, NonNullable<ApiPoint["serve1_box"]>> = {
  DEUCE: "deuce",
  AD: "ad",
};

const API_FAILURE_MODE: Record<FailureMode, NonNullable<ApiPoint["serve1_fault_mode"]>> = {
  NET: "net",
  LONG: "long",
  WIDE: "wide",
};

const API_RETURN_OUTCOME: Record<ReturnOutcome, NonNullable<ApiPoint["return_outcome"]>> = {
  IN: "in",
  NET: "net",
  LONG: "long",
  WIDE: "wide",
};

const API_END_REASON: Record<EndReason, ApiPoint["end_reason"]> = {
  FORCED: "forced",
  MISTAKE: "mistake",
  ACE: "ace",
  DOUBLE_FAULT: "double_fault",
  UNUSUAL: "unusual",
};

const API_UNUSUAL_REASON: Record<UnusualReason, NonNullable<ApiPoint["unusual_reason"]>> = {
  NET_TOUCH: "net_touch",
  BALL_HIT_PLAYER: "ball_hit_player",
  REACHED_OVER: "reached_over",
  DOUBLE_HIT: "double_hit",
  HINDRANCE: "hindrance",
  POINT_PENALTY: "point_penalty",
  OTHER: "other",
};

const API_WING: Record<Wing, NonNullable<ApiPoint["wing"]>> = {
  FOREHAND: "forehand",
  BACKHAND: "backhand",
};

const API_SHOT_TYPE: Record<ShotType, NonNullable<ApiPoint["shot_type"]>> = {
  DRIVE: "drive",
  VOLLEY: "volley",
  DROPSHOT: "dropshot",
  LOB: "lob",
};

const API_COURT_DEPTH: Record<CourtDepth, NonNullable<ApiPoint["ball_depth"]>> = {
  SHORT: "short",
  DEEP: "deep",
};

const API_RALLY_BUCKET: Record<RallyBucket, NonNullable<ApiPoint["rally_length_bucket"]>> = {
  B1: "b1",
  B2: "b2",
  B3: "b3",
  B4: "b4",
};

type ServeAttemptPayload = ReturnType<Point["toJSON"]>["serves"][number];

interface ApiServe {
  outcome: ApiPoint["serve1_outcome"];
  box: ApiPoint["serve1_box"];
  faultMode: ApiPoint["serve1_fault_mode"];
}

/** One serve attempt: its outcome, then the box it landed in or the way it missed. */
function apiServe(attempt: ServeAttemptPayload, server: Server, courtSide: CourtSide): ApiServe {
  const outcome = API_SERVE_OUTCOME[attempt.outcome];
  // Placement is the tracked player's alone, and a serve that landed is placed by the box
  // the point was played from — capture never records where inside the box it went.
  if (server !== "TRACKED") return { outcome, box: null, faultMode: null };
  if (attempt.outcome !== "FAULT")
    return { outcome, box: API_COURT_SIDE[courtSide], faultMode: null };
  if (attempt.location === null) {
    throw new Error("a tracked player's faulted serve records where it missed");
  }
  return { outcome, box: null, faultMode: API_FAILURE_MODE[attempt.location] };
}

/** One captured point as the API stores it, minus the id the importer mints itself. */
function toApiPoint(payload: ReturnType<Point["toJSON"]>): ApiPoint {
  // A Point may leave its serve or its ending unwatched and the API may not, so the two
  // the generator never produces are refused here rather than written out blank.
  const first = payload.serves[0];
  if (first === undefined) throw new Error(`point ${payload.id} records no serve to map`);
  if (payload.endReason === null) throw new Error(`point ${payload.id} records no ending to map`);
  const serve1 = apiServe(first, payload.server, payload.courtSide);
  const second = payload.serves[1];
  const serve2 = second && apiServe(second, payload.server, payload.courtSide);
  const location = payload.ballLocation;
  // ballIn is always true from the capture path, so the final ball is always a zone
  // (point.ts says so on the field itself); a FailureMode here would be imported data.
  if (typeof location === "string") {
    throw new Error(`point ${payload.id} records a final ball that went out`);
  }
  return {
    sequence: payload.sequence,
    server: API_SERVER[payload.server],
    won: payload.won,
    serve1_outcome: serve1.outcome,
    serve1_box: serve1.box,
    serve1_fault_mode: serve1.faultMode,
    serve2_outcome: serve2?.outcome ?? null,
    serve2_box: serve2?.box ?? null,
    serve2_fault_mode: serve2?.faultMode ?? null,
    return_outcome:
      payload.returnOutcome === null ? null : API_RETURN_OUTCOME[payload.returnOutcome],
    end_reason: API_END_REASON[payload.endReason],
    unusual_reason:
      payload.unusualReason === null ? null : API_UNUSUAL_REASON[payload.unusualReason],
    // One note column on this side of the wire, and a point can carry both a coach's
    // note and an unusual point's own, so they join the way capture joins two notes.
    note: [payload.note, payload.unusualNote].filter((text) => text !== null).join("\n") || null,
    wing: payload.wing === null ? null : API_WING[payload.wing],
    shot_type: payload.shotType === null ? null : API_SHOT_TYPE[payload.shotType],
    ball_in: payload.ballIn,
    ball_half: location === null ? null : API_COURT_SIDE[location.half],
    ball_depth: location === null ? null : API_COURT_DEPTH[location.depth],
    ball_out_mode: null,
    rally_length_bucket:
      payload.rallyLengthBucket === null ? null : API_RALLY_BUCKET[payload.rallyLengthBucket],
    set_number: payload.context.setNumber,
    game_number: payload.context.gameNumber,
    in_tiebreak: payload.context.inTiebreak,
    is_break_point: payload.context.isBreakPoint,
    is_game_point: payload.context.isGamePoint,
    is_game_end: payload.context.isGameEnd,
    is_set_point: payload.context.isSetPoint,
    is_set_end: payload.context.isSetEnd,
    is_match_point: payload.context.isMatchPoint,
  };
}

const IMPORT_PLAYER_COLUMNS = [
  "coach_email",
  "first_name",
  "last_name",
  "date_of_birth",
  "dominant_hand",
  "gender",
  "notes",
];

const IMPORT_MATCH_COLUMNS = [
  "coach_email",
  "player_first_name",
  "player_last_name",
  "opponent_name",
  "played_on",
  "surface",
  "event",
  "scoring_system",
  "result",
  "match_key",
];

// The point columns the CSV carries from PointCreate itself, in the spec's order. The
// header and the row are both built from this, so the two cannot drift apart the way a
// hand-ordered row of 29 same-typed cells can.
const IMPORT_POINT_FIELDS = [
  "sequence",
  "server",
  "won",
  "serve1_outcome",
  "serve1_box",
  "serve1_fault_mode",
  "serve2_outcome",
  "serve2_box",
  "serve2_fault_mode",
  "return_outcome",
  "end_reason",
  "unusual_reason",
  "note",
  "wing",
  "shot_type",
  "ball_in",
  "ball_half",
  "ball_depth",
  "ball_out_mode",
  "rally_length_bucket",
  "set_number",
  "game_number",
  "in_tiebreak",
  "is_break_point",
  "is_game_point",
  "is_game_end",
  "is_set_point",
  "is_set_end",
  "is_match_point",
] as const satisfies readonly (keyof ApiPoint)[];

const IMPORT_POINT_COLUMNS = ["coach_email", "match_key", ...IMPORT_POINT_FIELDS];

function importPointRow(
  coachEmail: string,
  matchKey: string,
  payload: ReturnType<Point["toJSON"]>,
): unknown[] {
  const point = toApiPoint(payload);
  // The generated schema carries the spec's own enums and required fields, so a member
  // the API renamed fails here rather than 16,000 rows into someone's prod import. It
  // checks shape alone: PointCreate's cross-field rules are the import's own to enforce.
  zPointCreate.parse({ id: payload.id, ...point });
  return [coachEmail, matchKey, ...IMPORT_POINT_FIELDS.map((field) => point[field])];
}

// --- Run -------------------------------------------------------------------------------

const players = makeRoster(PLAYER_COUNT);
const matches: GeneratedMatch[] = [];

const seasonDays = Math.round((SEASON_END.getTime() - SEASON_START.getTime()) / 86_400_000);

const circuits = new Map(players.map((player) => [player.id, circuitFor(player, players)]));
// What each player has already played, as `day:opponent`. The importer recognises a
// match by (player, played_on, opponent_name, event) and this generator leaves event
// blank, so a repeated pairing on a repeated day would import as one match and lose the
// second's points to the conflict clause that keeps a re-import idempotent.
const scheduled = new Map(players.map((player) => [player.id, new Set<string>()]));

for (let index = 0; index < MATCH_COUNT; index++) {
  const player = players[index % players.length]!;
  const opponent = pick(circuits.get(player.id)!);
  const taken = scheduled.get(player.id)!;
  let day = Math.floor(rng() * seasonDays);
  while (taken.has(`${String(day)}:${opponent.display}`)) day = (day + 1) % seasonDays;
  taken.add(`${String(day)}:${opponent.display}`);

  const playedOn = isoDate(new Date(SEASON_START.getTime() + day * 86_400_000));
  matches.push(generateMatch(player, opponent, playedOn));
}

matches.sort((left, right) => left.match.playedOn.localeCompare(right.match.playedOn));

mkdirSync(OUT_DIR, { recursive: true });

const bundle = {
  generator: "apps/web/scripts/generate-fake-data.ts",
  seed: SEED,
  coaches: COACHES,
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
      generated.points.length,
      generated.summary.gamesPlayed,
      generated.summary.attention,
    ]),
  ),
);

const pointRows = matches.flatMap((generated) =>
  generated.points.map((row) => pointRow(generated, row.payload)),
);

writeFileSync(resolve(OUT_DIR, "points.csv"), csv(POINT_COLUMNS, pointRows));

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

const IMPORT_DIR = resolve(OUT_DIR, "import");
mkdirSync(IMPORT_DIR, { recursive: true });

writeFileSync(
  resolve(IMPORT_DIR, "coaches.csv"),
  csv(
    ["email", "display_name"],
    COACHES.map((coach) => [coach.email, coach.displayName]),
  ),
);

writeFileSync(
  resolve(IMPORT_DIR, "players.csv"),
  csv(
    IMPORT_PLAYER_COLUMNS,
    players.map((player) => [
      emailOf(player),
      player.first_name,
      player.last_name,
      player.date_of_birth,
      player.dominant_hand,
      player.gender,
      player.notes,
    ]),
  ),
);

const playerById = new Map(players.map((player) => [player.id, player]));

writeFileSync(
  resolve(IMPORT_DIR, "matches.csv"),
  csv(
    IMPORT_MATCH_COLUMNS,
    matches.map((generated) => {
      const player = playerById.get(generated.match.trackedPlayerId)!;
      return [
        emailOf(player),
        player.first_name,
        player.last_name,
        generated.match.opponentName ?? generated.summary.opponentDisplayName,
        generated.match.playedOn,
        // The API has no "unspecified" surface; blank is how it says the same thing.
        generated.match.surfaceType === "unspecified" ? "" : generated.match.surfaceType,
        "",
        generated.match.scoringSystem,
        generated.outcome.trackedPlayerWon ? "win" : "loss",
        generated.points.length === 0 ? "" : generated.match.matchId,
      ];
    }),
  ),
);

writeFileSync(
  resolve(IMPORT_DIR, "points.csv"),
  csv(
    IMPORT_POINT_COLUMNS,
    matches.flatMap((generated) =>
      generated.points.map((row) =>
        importPointRow(
          emailOf(playerById.get(generated.match.trackedPlayerId)!),
          generated.match.matchId,
          row.payload,
        ),
      ),
    ),
  ),
);

// Quoted in the README below: a blank wing is nearly always a point with no shot to
// record, and saying so needs the real split rather than an assurance. A forced ending
// that struck a ball is the only blank the coach's attention accounts for — a missed
// return ends the point without one, whatever its end reason says.
const allPoints = matches.flatMap((generated) => generated.points.map((row) => row.payload));
const blankWings = allPoints.filter((payload) => payload.wing === null).length;
const unwatchedShots = allPoints.filter(
  (payload) =>
    payload.wing === null &&
    payload.endReason === "FORCED" &&
    (payload.returnOutcome === null || payload.returnOutcome === "IN"),
).length;
const percentUnwatched = ((unwatchedShots / blankWings) * 100).toFixed(0);

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
    "| `matches.csv` | One row per match, with the derived scoreline. |",
    "| `points.csv` | One row per captured point, every field flattened. |",
    "| `import/` | The same season in the four files the API's import script reads. |",
    "",
    "A `capture-data.json` sits here too after a run, holding the same data in the match log's own",
    "nested shape: a `Match.toJSON()` per match, then its points, each a `Point.toJSON()` exactly as",
    "the device stores them. It is gitignored for its size.",
    "",
    "## Reading a point",
    "",
    "A point's score fields (`won`, `server`, `court_side`, and the nine `context` stamps) are always",
    "set. An empty observation field almost always means the field does not apply to that point, not",
    "that the coach missed something: `wing` and `shot_type` are blank on every unforced error (the",
    "flow doesn't ask which stroke produced a miss), on aces, double faults and unusual points, and",
    "on a missed return, which `return_outcome` already places. The one genuine gap is a forced",
    `ending whose shot went unrecorded: ${grouped(unwatchedShots)} points, ${percentUnwatched}% of the ${grouped(blankWings)} with no \`wing\`.`,
    "",
    "Everything else capture may leave unseen — the serve, the ending, the final ball — is a column",
    "`PointCreate` takes non-null, and a game skipped behind a score checkpoint is a game with no",
    "points to import, so this dataset generates none of it. Serve placement is only ever recorded",
    "for the tracked player, and `ball_in` is always true, because capture records where the last",
    "ball to land finished, never where a miss went.",
    "",
    "## Importing it",
    "",
    "`import/` is what `apps/api/scripts/import_sample_data.py` ingests; that script's docstring",
    "covers running it and `apps/api/scripts/sample-data/README.md` is the format's spec.",
    `The squad is split between ${String(COACHES.length)} coaches (${COACHES.map((coach) => coach.email).join(", ")}),`,
    "so the demo can show one coach seeing only their own players. They share the one password the",
    "import prints when it finishes.",
    "",
    "## Regenerating",
    "",
    "```sh",
    `pnpm --filter @matchpoint/web gen-fake-data -- --seed ${String(SEED)} --players ${String(PLAYER_COUNT)} --matches ${String(MATCH_COUNT)}`,
    "```",
    "",
  ].join("\n"),
);

const wins = matches.filter((generated) => generated.outcome.trackedPlayerWon).length;
process.stdout.write(
  [
    `seed ${String(SEED)} -> ${OUT_DIR}`,
    `${String(players.length)} players, ${String(matches.length)} matches (${String(wins)} won by the tracked player)`,
    `${String(pointRows.length)} points`,
    "",
  ].join("\n"),
);
