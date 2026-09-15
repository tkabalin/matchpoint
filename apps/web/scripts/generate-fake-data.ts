/**
 * Generates a fake dataset in the shape capture actually produces.
 *
 * Nothing here invents a Point by hand: every point is built by driving the real
 * capture flow (`startPoint`/`transition`/`commitDraft`) with simulated taps, and the
 * score comes from the real fold, so a point that could not be captured on a phone
 * cannot come out of here either. The tennis itself is a coin-weighting model, not a
 * simulation of shot mechanics — realistic distributions, not realistic rallies.
 *
 * Two sets of CSVs come out: the capture model's own columns, and `import/`, the files
 * `apps/api/scripts/import_sample_data.py` reads. The second goes through the sync
 * layer's own payload mappers (`features/sync/`), so what the importer stores is what a
 * phone would have flushed, gaps included: a serve or an ending the coach didn't see,
 * and a run of games declared on the score editor rather than captured.
 *
 * The CSVs it writes are committed; the JSON bundle beside them is the same data in
 * the log's own nested shape, and is gitignored — it is 70 MB and regenerates from
 * the seed.
 *
 * Run: pnpm --filter @matchpoint/web gen-fake-data [-- --seed 13 --players 36
 *      --matches 360 --out apps/web/scripts/fake-data]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  NoteFocus,
  PlayerNoteCreate,
  PointCreate,
  ScoreCheckpointCreate,
} from "@matchpoint/api-client";
import {
  zPlayerNoteCreate,
  zPointCreate,
  zScoreCheckpointCreate,
} from "@matchpoint/api-client/zod";

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
  applyPoint,
  contextFor,
  coverageOf,
  foldScore,
  initialBoard,
  nextCourtSideFor,
  nextServerFor,
  snapshotOf,
} from "../src/features/capture/score.ts";
import type { MatchEvent, Scoreboard } from "../src/features/capture/score.ts";
import { toScoreCheckpointCreate } from "../src/features/sync/checkpoint-payload.ts";
import { toPointCreate } from "../src/features/sync/point-payload.ts";

// --- Configuration ---------------------------------------------------------------

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

// 13 rather than any other: the squad lands at 61 wins of 120 with no unbeaten and no
// winless player, so the ranking screens have a spread to rank on.
const SEED = Number(flag("seed", "13"));
const PLAYER_COUNT = Number(flag("players", "36"));
const MATCH_COUNT = Number(flag("matches", "360"));
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  flag("out", "apps/web/scripts/fake-data"),
);

const IMPORT_DIR = resolve(OUT_DIR, "import");

// The season the matches are spread over, oldest first.
const SEASON_START = new Date(2025, 8, 6);
const SEASON_END = new Date(2026, 7, 22);
const seasonDays = Math.round((SEASON_END.getTime() - SEASON_START.getTime()) / 86_400_000);

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
  /** Not API fields — the generator's own knobs, kept so a run can be explained. */
  archetype: string;
  skill: Skill;
}

// Each name carries the gender it usually reads as, so a player's profile, gender field
// and photo agree; the roster still draws a few "other" players across every name.
const FIRST_NAMES: readonly (readonly [string, "male" | "female"])[] = [
  ["Thabo", "male"],
  ["Aisha", "female"],
  ["Liam", "male"],
  ["Nomsa", "female"],
  ["Ravi", "male"],
  ["Chloe", "female"],
  ["Sipho", "male"],
  ["Hannah", "female"],
  ["Yusuf", "male"],
  ["Zanele", "female"],
  ["Daniel", "male"],
  ["Priya", "female"],
  ["Kagiso", "male"],
  ["Emma", "female"],
  ["Tendai", "male"],
  ["Jonas", "male"],
  ["Lerato", "female"],
  ["Sarah", "female"],
  ["Marco", "male"],
  ["Naledi", "female"],
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

type Tier = "strong" | "middling" | "weak";
type Temperament = "aggressive" | "balanced" | "passive";
type ServeStyle = "big" | "steady";

/**
 * A stereotype a coach would recognise, and the knobs it sets. Each coach's roster
 * cycles through the list in order, so every squad holds the same spread: a player to
 * beat, one to worry about, a lefty, a net rusher, a pusher. The note is the coach's own
 * one-line read of them, so the profile page agrees with the numbers underneath.
 */
interface Archetype {
  label: string;
  tier: Tier;
  temperament: Temperament;
  serve: ServeStyle;
  hand: "right" | "left";
  note: string | null;
}

const ARCHETYPES: readonly Archetype[] = [
  {
    label: "all-court leader",
    tier: "strong",
    temperament: "balanced",
    serve: "steady",
    hand: "right",
    note: "Squad's benchmark. Nothing to fix, plenty to sharpen.",
  },
  {
    label: "lefty big server",
    tier: "strong",
    temperament: "aggressive",
    serve: "big",
    hand: "left",
    note: "Serve wins some matches on its own. Second serve is the tell.",
  },
  {
    label: "grinder",
    tier: "strong",
    temperament: "passive",
    serve: "steady",
    hand: "right",
    note: "Best mover in the squad; wins the long ones.",
  },
  {
    label: "net rusher",
    tier: "middling",
    temperament: "aggressive",
    serve: "big",
    hand: "right",
    note: "Net game is well ahead of the baseline game.",
  },
  {
    label: "steady baseliner",
    tier: "middling",
    temperament: "passive",
    serve: "steady",
    hand: "left",
    note: "Never misses, never hurts anyone. Needs a finishing shot.",
  },
  {
    label: "streaky hitter",
    tier: "middling",
    temperament: "aggressive",
    serve: "steady",
    hand: "right",
    note: "Strong forehand, avoids the backhand under pressure.",
  },
  {
    label: "counterpuncher",
    tier: "middling",
    temperament: "balanced",
    serve: "steady",
    hand: "right",
    note: null,
  },
  {
    label: "raw power",
    tier: "weak",
    temperament: "aggressive",
    serve: "big",
    hand: "left",
    note: "Hits harder than anyone here and misses more than anyone here.",
  },
  {
    label: "pusher",
    tier: "weak",
    temperament: "passive",
    serve: "steady",
    hand: "right",
    note: "Rushes between points when behind.",
  },
  {
    label: "improver",
    tier: "weak",
    temperament: "balanced",
    serve: "steady",
    hand: "right",
    note: "Started in July. Every match is a first.",
  },
  {
    label: "serve-reliant",
    tier: "middling",
    temperament: "balanced",
    serve: "big",
    hand: "right",
    note: "Second serve is the weak link, sits up on big points.",
  },
  {
    label: "lefty scrambler",
    tier: "weak",
    temperament: "passive",
    serve: "big",
    hand: "left",
    note: null,
  },
];

const RALLY_BY_TIER: Record<Tier, readonly [number, number]> = {
  strong: [0.62, 0.78],
  middling: [0.45, 0.6],
  weak: [0.28, 0.42],
};

const AGGRESSION_BY_TEMPERAMENT: Record<Temperament, readonly [number, number]> = {
  aggressive: [0.7, 0.9],
  balanced: [0.4, 0.6],
  passive: [0.1, 0.3],
};

// A big server trades first serves in for aces; a steady one lands them and wins few
// points outright off them.
const SERVE_BY_STYLE: Record<
  ServeStyle,
  Record<"firstServeIn" | "secondServeIn" | "aceRate", readonly [number, number]>
> = {
  big: { firstServeIn: [0.5, 0.58], secondServeIn: [0.83, 0.9], aceRate: [0.1, 0.16] },
  steady: { firstServeIn: [0.66, 0.74], secondServeIn: [0.92, 0.97], aceRate: [0.02, 0.05] },
};

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

/** The archetype's ranges, with room inside each so two of a kind still differ. */
function skillFor(archetype: Archetype): Skill {
  const serve = SERVE_BY_STYLE[archetype.serve];
  return {
    rally: between(...RALLY_BY_TIER[archetype.tier]),
    firstServeIn: between(...serve.firstServeIn),
    secondServeIn: between(...serve.secondServeIn),
    aceRate: between(...serve.aceRate),
    aggression: between(...AGGRESSION_BY_TEMPERAMENT[archetype.temperament]),
  };
}

function makeRoster(count: number): RosterPlayer[] {
  const players: RosterPlayer[] = [];
  const used = new Set<string>();
  while (players.length < count) {
    const [first, usualGender] = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    if (used.has(name)) continue;
    used.add(name);
    const birthYear = 2000 + Math.floor(rng() * 12);
    const created = new Date(2025, 7, 1 + Math.floor(rng() * 30));
    // Coaches are dealt round-robin below, so the nth player of any coach is the nth
    // archetype: every roster covers the same spread.
    const archetype = ARCHETYPES[Math.floor(players.length / COACHES.length) % ARCHETYPES.length]!;
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
      dominant_hand: archetype.hand,
      gender: chance(1 / 11) ? "other" : usualGender,
      notes: archetype.note,
      // Round-robin rather than random, so no coach draws an empty roster.
      coach_id: COACHES[players.length % COACHES.length]!.id,
      photo_url: null,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
      has_transfer_code: chance(0.2),
      archetype: archetype.label,
      skill: skillFor(archetype),
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
 * A coach watching a match is not a camera. Each match draws one of these, so the gaps
 * cluster the way they really do rather than sprinkling evenly across every match: a
 * serve nobody watched (per attempt), an ending seen only as "they won it", and the
 * shot that ended a point going unrecorded. `gap` is a stretch of whole games the coach
 * declares on the score editor rather than captures (a phone call, a second court).
 */
interface Attention {
  label: "close" | "typical" | "light";
  missServe: number;
  missEnding: number;
  missShot: number;
  note: number;
  gap: number;
}

const ATTENTION: readonly (readonly [Attention, number])[] = [
  [
    { label: "close", missServe: 0.004, missEnding: 0.005, missShot: 0.02, note: 0.006, gap: 0.02 },
    35,
  ],
  [
    { label: "typical", missServe: 0.02, missEnding: 0.02, missShot: 0.09, note: 0.01, gap: 0.06 },
    45,
  ],
  [
    { label: "light", missServe: 0.05, missEnding: 0.06, missShot: 0.24, note: 0.014, gap: 0.15 },
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

/** An aggressive player finishes at the net; a passive one lobs and drops. */
function shotType(aggression: number): ShotType {
  return weighted([
    ["DRIVE", 60],
    ["VOLLEY", 6 + aggression * 30],
    ["DROPSHOT", 16 - aggression * 12],
    ["LOB", 14 - aggression * 12],
  ] as const);
}

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

/** From both players' temperaments together: two aggressive players end points early. */
function rallyBucket(aggression: number): RallyBucket {
  return weighted([
    ["B1", 30 + aggression * 30],
    ["B2", 30],
    ["B3", 24 - aggression * 16],
    ["B4", 16 - aggression * 12],
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
 * An unusual ending, from the serve or the final-ball screen alike: the winner is
 * mandatory, the reason is not, and a coach who can't name the rule taps past it.
 */
function unusualEnding(act: (action: CaptureAction) => void, won: boolean): void {
  act({ type: "TAP_UNUSUAL" });
  act({ type: "TAP_UNUSUAL_OUTCOME", won });
  act({ type: "TAP_UNUSUAL_REASON", reason: chance(0.15) ? null : weighted(UNUSUAL_REASONS) });
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
  const done = () => finish(state, match, board, sequence, timestamp);

  // Settled before the point is played out: a missed return is one of the ways the
  // receiver loses a point on this serve, not a second one stacked on the rally — the
  // server's edge already prices the returns nobody puts back.
  const rallyWon = (onFirstServe: boolean) => {
    const serverWins = chance(serverRallyEdge(serverSkill, receiverSkill, onFirstServe));
    return trackedServing ? serverWins : !serverWins;
  };

  // The header's note button, which is valid on any step and doesn't advance the flow.
  if (chance(attention.note)) act({ type: "ADD_NOTE", text: pick(COACH_NOTES) });

  // An unusual ending called from the serve screen keeps nothing about the serve.
  if (chance(0.0015)) {
    unusualEnding(act, rallyWon(true));
    return done();
  }

  let onFirstServe = true;
  let serveWatched = true;

  if (chance(attention.missServe)) {
    // The coach looked away for the serve: no attempt is recorded, and the flow moves
    // on to the rally as if it had landed.
    act({ type: "TAP_DIDNT_SEE" });
    serveWatched = false;
  } else {
    const firstIn = chance(serverSkill.firstServeIn);
    if (firstIn && chance(serverSkill.aceRate)) {
      act({ type: "TAP_SERVE_ACE" });
      return done();
    }
    if (!firstIn) {
      onFirstServe = false;
      act(
        trackedServing
          ? { type: "TAP_SERVE_FAULT", location: failureMode() }
          : { type: "TAP_SERVE_FAULT" },
      );
      if (chance(attention.missServe)) {
        // A first fault the coach saw, then a second attempt they didn't: the lone
        // fault stays, the same observation hole as no serve at all.
        act({ type: "TAP_DIDNT_SEE" });
        serveWatched = false;
      } else {
        const secondIn = chance(serverSkill.secondServeIn);
        if (!secondIn) {
          act(
            trackedServing
              ? { type: "TAP_SERVE_FAULT", location: failureMode() }
              : { type: "TAP_SERVE_FAULT" },
          );
          return done();
        }
        if (chance(serverSkill.aceRate * 0.25)) {
          act({ type: "TAP_SERVE_ACE" });
          return done();
        }
      }
    }
  }

  const won = rallyWon(onFirstServe);

  // An unwatched serve skipped these screens: the flow is already on the final ball.
  if (serveWatched) {
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
        return done();
      }
      act({ type: "TAP_RETURN", outcome: "IN" });
    }
  }

  if (chance(0.008)) {
    unusualEnding(act, won);
    return done();
  }

  if (chance(attention.missEnding)) {
    // The coach saw who won and nothing else: the ending, the rally length and the
    // final ball all stay null.
    act({ type: "TAP_DIDNT_SEE", won });
    return done();
  }

  // Always in: capture records where the last good ball finished on the loser's half,
  // never where a miss went (see point.ts's own comment on ballIn).
  act({ type: "TAP_BALL_LOCATION", won, ballIn: true, location: courtZone() });
  act({
    type: "TAP_RALLY_LENGTH",
    bucket: rallyBucket((tracked.aggression + opponent.aggression) / 2),
  });

  // An aggressive winner forces more endings; an aggressive loser hands more over.
  const winnerAggression = won ? tracked.aggression : opponent.aggression;
  const loserAggression = won ? opponent.aggression : tracked.aggression;
  const endReason = chance(0.42 + winnerAggression * 0.3 - loserAggression * 0.2)
    ? "FORCED"
    : "MISTAKE";
  act({ type: "TAP_ENDING", endReason });

  if (endReason === "FORCED") {
    if (chance(attention.missShot)) {
      act({ type: "TAP_DIDNT_SEE" });
    } else {
      const wing: Wing = chance(0.62) ? "FOREHAND" : "BACKHAND";
      act({ type: "TAP_SHOT_DETAIL", wing, shotType: shotType(winnerAggression) });
    }
  }

  return done();
}

/**
 * Who won a point nobody captured, for the games a checkpoint stands in for: the same
 * coin model as capturePoint without the taps.
 */
function unrecordedPointWon(board: Scoreboard, tracked: Skill, opponent: Skill): boolean {
  const server = nextServerFor(board);
  const serverSkill = server === "TRACKED" ? tracked : opponent;
  const receiverSkill = server === "TRACKED" ? opponent : tracked;
  const firstIn = chance(serverSkill.firstServeIn);
  if (!firstIn && !chance(serverSkill.secondServeIn)) return server !== "TRACKED";
  const serverWins = chance(serverRallyEdge(serverSkill, receiverSkill, firstIn));
  return server === "TRACKED" ? serverWins : !serverWins;
}

/** Commits the finished draft — live-match's `advance`. */
function finish(
  final: CaptureState,
  match: Match,
  board: Scoreboard,
  sequence: number,
  timestamp: number,
): Point {
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

/** The row the score editor queues for each checkpoint, as the outbox stores it. */
interface LoggedCheckpointRow {
  id: string;
  matchId: string;
  coachId: string;
  sequence: number;
  payload: ReturnType<ScoreCheckpoint["toJSON"]>;
}

interface GeneratedMatch {
  match: ReturnType<Match["toJSON"]>;
  /** The row live-match queues when the coach ends the match. */
  outcome: { reason: MatchEndReason | "completed"; trackedPlayerWon: boolean };
  points: LoggedPointRow[];
  checkpoints: LoggedCheckpointRow[];
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

// Most club matches are filed under no event at all; the named ones give the match
// list something to filter and the importer's natural key a fourth column to differ on.
const EVENTS: readonly (readonly [string | null, number])[] = [
  [null, 60],
  ["Club championships", 9],
  ["Winter league", 9],
  ["Ladder match", 8],
  ["Junior open", 6],
  ["Friendly", 5],
  ["Provincial trials", 3],
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
    event: weighted(EVENTS),
    outcomeOverride: null,
  });

  const captured: Point[] = [];
  const checkpoints: ScoreCheckpoint[] = [];
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
      checkpoints: [],
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
  // So is the gap: a stretch of whole games nobody captured, closed by the coach
  // declaring the board on the score editor once they were back.
  const gap = chance(attention.gap)
    ? { afterPoints: 20 + Math.floor(rng() * 80), games: 1 + Math.floor(rng() * 3) }
    : null;
  let gapTaken = false;

  let guard = 0;
  while (board.matchWinner === null && guard < 900) {
    guard += 1;

    if (retiresAfter !== null && captured.length >= retiresAfter) break;

    if (gap !== null && !gapTaken && captured.length >= gap.afterPoints) {
      gapTaken = true;
      // Played through to the end of the last missed game, so the declared board is a
      // game boundary, which is where a coach catching up actually declares it.
      const target = coverageOf(board).slotsPlayed + gap.games;
      while (board.matchWinner === null && coverageOf(board).slotsPlayed < target) {
        board = applyPoint(match, board, unrecordedPointWon(board, playerForm, opponentForm));
        timestamp += 20_000 + Math.floor(rng() * 45_000);
      }
      checkpoints.push(
        ScoreCheckpoint.create({
          id: uuid(),
          matchId: match.matchId,
          timestamp,
          sequence,
          after: snapshotOf(board),
          servesNext: nextServerFor(board),
          orderChanged: false,
        }),
      );
      sequence += 1;
      continue;
    }

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
  const events: MatchEvent[] = [...captured, ...checkpoints].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const folded = foldScore(match, events);
  if (folded.ignored.length > 0) {
    throw new Error(
      `match ${match.matchId} logged ${String(folded.ignored.length)} ignored events`,
    );
  }
  if (scorelineOf(folded) !== scorelineOf(board)) {
    throw new Error(
      `match ${match.matchId} folds to ${scorelineOf(folded)}, board says ${scorelineOf(board)}`,
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
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      matchId: match.matchId,
      coachId: player.coach_id,
      sequence: checkpoint.sequence,
      payload: checkpoint.toJSON(),
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

// --- Coach notes -------------------------------------------------------------------
//
// Not capture: the dated notes a coach files on the player screen between matches, so
// they are drawn after the season and never touch a point. Each is filed under the focus
// areas the note form offers, and what a coach writes about follows the player's
// temperament, so the notes read against the same numbers the archetype produced.

interface GeneratedNote {
  id: string;
  playerId: string;
  recordedOn: string;
  focusAreas: NoteFocus[];
  body: string;
}

const NOTE_BODIES: Record<NoteFocus, readonly string[]> = {
  technical: [
    "Backhand grip slipping to continental under pressure. Shadow swings before the next session.",
    "Ball toss drifting left on the second serve. Worked on catching it three times before serving.",
    "Contact point late on the forehand when rushed. Split step earlier.",
    "Volleys were punched, not blocked. Good session.",
    "Slice backhand floating. Needs a lower finish.",
  ],
  mental: [
    "Went quiet after dropping serve at 4-4. Talked about resetting between points.",
    "Best focus of the season. Stayed with the routine on every big point.",
    "Rushing between points when behind. Agreed on a towel routine.",
    "Argued a line call and lost the next three games. Discussed letting it go.",
    "Calm through a long second set. Big step.",
  ],
  physical: [
    "Legs went in the third set. Adding the interval session on Thursdays.",
    "Recovery step much sharper after the ladder work.",
    "Stiff on the first change of direction. Warm-up needs to be longer.",
    "Cramping late in the second match of the day. Hydration plan for tournaments.",
    "Fastest to the drop shot in the group today.",
  ],
  tactical: [
    "Coming to the net behind nothing. Approach off the short ball only.",
    "Serve-plus-one pattern working: wide serve, forehand to the open court.",
    "Kept pulling the trigger from behind the baseline. Build the point first.",
    "Found the opponent's backhand early and stayed on it. Good match plan.",
    "Playing every point the same way. Vary the return position on second serves.",
  ],
};

const NOTE_FOCUS_BY_TEMPERAMENT: Record<Temperament, readonly (readonly [NoteFocus, number])[]> = {
  aggressive: [
    ["tactical", 4],
    ["mental", 3],
    ["technical", 2],
    ["physical", 1],
  ],
  balanced: [
    ["technical", 3],
    ["tactical", 2],
    ["mental", 2],
    ["physical", 2],
  ],
  passive: [
    ["technical", 3],
    ["physical", 3],
    ["tactical", 2],
    ["mental", 1],
  ],
};

function generateNotes(
  player: RosterPlayer,
  archetype: Archetype,
  playedOn: readonly string[],
): GeneratedNote[] {
  const count = 3 + Math.floor(rng() * 6);
  const notes: GeneratedNote[] = [];
  for (let index = 0; index < count; index++) {
    // Half the notes are the match-day write-up, the rest a training session.
    const onMatchDay = playedOn.length > 0 && chance(0.5);
    const recordedOn = onMatchDay
      ? pick(playedOn)
      : isoDate(new Date(SEASON_START.getTime() + Math.floor(rng() * seasonDays) * 86_400_000));
    const focus = weighted(NOTE_FOCUS_BY_TEMPERAMENT[archetype.temperament]);
    const focusAreas: NoteFocus[] = [focus];
    // A fifth of notes are filed under two areas, the way a shortening backswing
    // under pressure is technical and mental at once.
    if (chance(0.2)) {
      const second = weighted(NOTE_FOCUS_BY_TEMPERAMENT[archetype.temperament]);
      if (second !== focus) focusAreas.push(second);
    }
    notes.push({
      id: uuid(),
      playerId: player.id,
      recordedOn,
      focusAreas,
      body: pick(NOTE_BODIES[focus]),
    });
  }
  return notes.sort((left, right) => left.recordedOn.localeCompare(right.recordedOn));
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
  "event",
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
// `apps/api/scripts/import_sample_data.py` reads these files and
// `apps/api/scripts/import_sample_data.md` is their spec: the same season under the API's
// column names and lower-case enum values, with a match_key standing in for the match id
// it never stores. The rows come from the sync layer's own mappers, so a point or a
// checkpoint here is the request body a phone would have sent for it.

const CHECKPOINT_COLUMNS = [
  "match_id",
  "checkpoint_id",
  "sequence",
  "timestamp",
  "serves_next",
  "order_changed",
  "after",
];

function checkpointRow(
  generated: GeneratedMatch,
  payload: ReturnType<ScoreCheckpoint["toJSON"]>,
): unknown[] {
  return [
    generated.match.matchId,
    payload.id,
    payload.sequence,
    new Date(payload.timestamp).toISOString(),
    payload.servesNext,
    payload.orderChanged,
    JSON.stringify(payload.after),
  ];
}

/**
 * The face committed for the nth player or coach, as the importer's cell names it, or
 * blank when none has been. The photos are not generated: they were fetched once from
 * thispersondoesnotexist.com, chosen to fit each row's gender and age, and committed
 * under `photos/` (see the README). So a roster larger than the set of faces simply runs
 * out of photos, rather than naming files the importer cannot find.
 */
function photoCell(kind: "player" | "coach", index: number): string {
  const name = `photos/${kind}-${String(index + 1).padStart(2, "0")}.webp`;
  return existsSync(resolve(IMPORT_DIR, name)) ? name : "";
}

const IMPORT_PLAYER_COLUMNS = [
  "coach_email",
  "first_name",
  "last_name",
  "date_of_birth",
  "dominant_hand",
  "gender",
  "notes",
  "photo",
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
  "result_reason",
  "match_key",
];

// The point columns the CSV carries from PointCreate itself, in the spec's order. The
// header and the row are both built from this, so the two cannot drift apart the way a
// hand-ordered row of 29 same-typed cells can.
const IMPORT_POINT_FIELDS = [
  "sequence",
  "server",
  "won",
  "court_side",
  "serve1_outcome",
  "serve1_fault_mode",
  "serve2_outcome",
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
] as const satisfies readonly (keyof Omit<PointCreate, "id">)[];

const IMPORT_POINT_COLUMNS = ["coach_email", "match_key", ...IMPORT_POINT_FIELDS];

function importPointRow(
  coachEmail: string,
  matchKey: string,
  payload: ReturnType<Point["toJSON"]>,
): unknown[] {
  const point = toPointCreate(Point.fromJSON(payload));
  // The generated schema carries the spec's own enums and required fields, so a member
  // the API renamed fails here rather than 50,000 rows into someone's prod import. It
  // checks shape alone: PointCreate's cross-field rules are the import's own to enforce.
  zPointCreate.parse(point);
  return [coachEmail, matchKey, ...IMPORT_POINT_FIELDS.map((field) => point[field])];
}

// `after` travels as one JSON cell: the importer validates it through the same schema
// the ingest route does, and it is the schema's one document-shaped field.
const IMPORT_CHECKPOINT_FIELDS = [
  "sequence",
  "serves_next",
  "order_changed",
  "after",
] as const satisfies readonly (keyof Omit<ScoreCheckpointCreate, "id">)[];

const IMPORT_CHECKPOINT_COLUMNS = ["coach_email", "match_key", ...IMPORT_CHECKPOINT_FIELDS];

function importCheckpointRow(
  coachEmail: string,
  matchKey: string,
  match: ReturnType<Match["toJSON"]>,
  payload: ReturnType<ScoreCheckpoint["toJSON"]>,
): unknown[] {
  const checkpoint = toScoreCheckpointCreate(
    Match.fromJSON(match),
    ScoreCheckpoint.fromJSON(payload),
  );
  zScoreCheckpointCreate.parse(checkpoint);
  return [
    coachEmail,
    matchKey,
    ...IMPORT_CHECKPOINT_FIELDS.map((field) =>
      field === "after" ? JSON.stringify(checkpoint.after) : checkpoint[field],
    ),
  ];
}

// --- Run -------------------------------------------------------------------------------

const players = makeRoster(PLAYER_COUNT);
const matches: GeneratedMatch[] = [];

const circuits = new Map(players.map((player) => [player.id, circuitFor(player, players)]));
// What each player has already played, as `day:opponent`. The importer recognises a
// match by (player, played_on, opponent_name, event), and two matches against one
// opponent on one day may well draw the same event, so a repeated pairing on a repeated
// day could import as one match and lose the second's points to the conflict clause
// that keeps a re-import idempotent.
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

// After the season, so that adding or changing the notes leaves every point as it was.
const archetypeByLabel = new Map(ARCHETYPES.map((archetype) => [archetype.label, archetype]));
const notes = players.flatMap((player) =>
  generateNotes(
    player,
    archetypeByLabel.get(player.archetype)!,
    matches
      .filter((generated) => generated.match.trackedPlayerId === player.id)
      .map((generated) => generated.match.playedOn),
  ),
);

mkdirSync(OUT_DIR, { recursive: true });

const bundle = {
  generator: "apps/web/scripts/generate-fake-data.ts",
  seed: SEED,
  coaches: COACHES,
  /** Every payload below is a `toJSON()` from the capture model, unchanged. */
  players,
  matches,
  notes,
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
      generated.match.event,
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
  resolve(OUT_DIR, "checkpoints.csv"),
  csv(
    CHECKPOINT_COLUMNS,
    matches.flatMap((generated) =>
      generated.checkpoints.map((row) => checkpointRow(generated, row.payload)),
    ),
  ),
);

writeFileSync(
  resolve(OUT_DIR, "notes.csv"),
  csv(
    ["player_id", "note_id", "recorded_on", "focus_areas", "body"],
    notes.map((note) => [
      note.playerId,
      note.id,
      note.recordedOn,
      note.focusAreas.join(" "),
      note.body,
    ]),
  ),
);

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
      "archetype",
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
      player.archetype,
    ]),
  ),
);

mkdirSync(IMPORT_DIR, { recursive: true });

writeFileSync(
  resolve(IMPORT_DIR, "coaches.csv"),
  csv(
    ["email", "display_name", "photo"],
    COACHES.map((coach, index) => [coach.email, coach.displayName, photoCell("coach", index)]),
  ),
);

writeFileSync(
  resolve(IMPORT_DIR, "players.csv"),
  csv(
    IMPORT_PLAYER_COLUMNS,
    players.map((player, index) => [
      emailOf(player),
      player.first_name,
      player.last_name,
      player.date_of_birth,
      player.dominant_hand,
      player.gender,
      player.notes,
      photoCell("player", index),
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
        generated.match.event,
        generated.match.scoringSystem,
        generated.outcome.trackedPlayerWon ? "win" : "loss",
        generated.outcome.reason,
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

writeFileSync(
  resolve(IMPORT_DIR, "checkpoints.csv"),
  csv(
    IMPORT_CHECKPOINT_COLUMNS,
    matches.flatMap((generated) =>
      generated.checkpoints.map((row) =>
        importCheckpointRow(
          emailOf(playerById.get(generated.match.trackedPlayerId)!),
          generated.match.matchId,
          generated.match,
          row.payload,
        ),
      ),
    ),
  ),
);

// focus_areas travels space-separated: the values are single words, and a list in one
// cell is the shape the importer's spec documents.
const IMPORT_NOTE_COLUMNS = [
  "coach_email",
  "player_first_name",
  "player_last_name",
  "recorded_on",
  "focus_areas",
  "body",
];

writeFileSync(
  resolve(IMPORT_DIR, "notes.csv"),
  csv(
    IMPORT_NOTE_COLUMNS,
    notes.map((note) => {
      const player = playerById.get(note.playerId)!;
      const body: PlayerNoteCreate = {
        body: note.body,
        recorded_on: note.recordedOn,
        focus_areas: note.focusAreas,
      };
      zPlayerNoteCreate.parse(body);
      return [
        emailOf(player),
        player.first_name,
        player.last_name,
        body.recorded_on,
        body.focus_areas?.join(" ") ?? "",
        body.body,
      ];
    }),
  ),
);

// Quoted in the README below: the gaps are real, so the README says how many rather
// than assuring the reader they are rare. A forced ending that struck a ball is the one
// blank wing the coach's attention accounts for — a missed return ends the point
// without one, whatever its end reason says.
const allPoints = matches.flatMap((generated) => generated.points.map((row) => row.payload));
const unwatchedServes = allPoints.filter(
  (payload) =>
    payload.serves.length === 0 ||
    (payload.serves.length === 1 && payload.serves[0]?.outcome === "FAULT"),
).length;
const unwatchedEndings = allPoints.filter((payload) => payload.endReason === null).length;
const blankWings = allPoints.filter((payload) => payload.wing === null).length;
const unwatchedShots = allPoints.filter(
  (payload) =>
    payload.wing === null &&
    payload.endReason === "FORCED" &&
    (payload.returnOutcome === null || payload.returnOutcome === "IN"),
).length;
const percentUnwatched = ((unwatchedShots / blankWings) * 100).toFixed(0);
const checkpointCount = matches.reduce(
  (total, generated) => total + generated.checkpoints.length,
  0,
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
    "| `matches.csv` | One row per match, with the derived scoreline. |",
    "| `points.csv` | One row per captured point, every field flattened. |",
    "| `checkpoints.csv` | One row per score checkpoint, the board as the coach declared it. |",
    "| `notes.csv` | One row per coach note, dated and filed under its focus areas. |",
    "| `import/` | The same season in the files the API's import script reads, plus `photos/`. |",
    "",
    "A `capture-data.json` sits here too after a run, holding the same data in the match log's own",
    "nested shape: a `Match.toJSON()` per match, then its points, each a `Point.toJSON()` exactly as",
    "the device stores them. It is gitignored for its size.",
    "",
    "## The roster",
    "",
    `Each coach's ${String(Math.ceil(PLAYER_COUNT / COACHES.length))} players cycle through the same ${String(ARCHETYPES.length)} archetypes (\`players.csv\`'s`,
    "`archetype` column), so every squad has its all-court leader, its lefty big server, its pusher",
    "and so on. An archetype fixes a player's tier, temperament, serve style and dominant hand, and",
    "the temperament reaches the points: an aggressive player ends rallies early, at the net, and",
    "hands over more unforced errors; a passive one lobs, drops and grinds.",
    "",
    `Each player also has a handful of dated coach notes (${grouped(notes.length)} in all), half written up on a`,
    "match day and half after a training session, filed under the focus areas the note form offers.",
    "What a coach writes about follows the player's temperament: an aggressive player's notes lean",
    "tactical and mental, a passive player's technical and physical.",
    "",
    "`import/photos/` holds a face for every player and coach, named for the row it belongs to",
    "(`player-07.webp` is the seventh row of `import/players.csv`). They are the one thing here the",
    "seed does not regenerate: each was fetched once from thispersondoesnotexist.com, picked by",
    "hand to fit the row's gender and age, and committed. A roster larger than the set runs out",
    "of photos rather than naming files the importer cannot find.",
    "",
    "## Reading a point",
    "",
    "A point's score fields (`won`, `server`, `court_side`, and the nine `context` stamps) are always",
    "set. An empty observation field usually means the field does not apply to that point, not",
    "that the coach missed something: `wing` and `shot_type` are blank on every unforced error (the",
    "flow doesn't ask which stroke produced a miss), on aces, double faults and unusual points, and",
    "on a missed return, which `return_outcome` already places.",
    "",
    "The gaps capture allows are here too, at the rate a coach actually leaves them, clustered by",
    `match. ${grouped(unwatchedServes)} points have a serve nobody watched (no attempt, or a lone first fault), ${grouped(unwatchedEndings)}`,
    "have an ending seen only as who won it (`end_reason` null, and the rally length and final ball",
    `with it), and ${grouped(unwatchedShots)} forced endings went by without their shot, ${percentUnwatched}% of the ${grouped(blankWings)} with no \`wing\`.`,
    `${String(checkpointCount)} matches hold a score checkpoint: a run of games the coach declared on the score`,
    "editor rather than captured, so those games have no points and the set score comes from the",
    "checkpoint. Serve placement is only ever recorded for the tracked player, and `ball_in` is",
    "always true, because capture records where the last ball to land finished, never where a miss",
    "went.",
    "",
    "## Importing it",
    "",
    "`import/` is what `apps/api/scripts/import_sample_data.py` ingests; that script's docstring",
    "covers running it and `apps/api/scripts/import_sample_data.md` is the format's spec.",
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
