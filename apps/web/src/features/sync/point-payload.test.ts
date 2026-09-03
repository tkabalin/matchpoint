import { zPointCreate } from "@matchpoint/api-client/zod";
import { describe, expect, test } from "vitest";

import { NOTE_MAX_LENGTH, Point } from "@/features/capture/point";

import { toPointCreate } from "./point-payload";

const POINT_ID = "3f1c2b4e-0000-4000-8000-000000000010";
const MATCH_ID = "3f1c2b4e-0000-4000-8000-000000000011";

const CONTEXT = {
  setNumber: 2,
  gameNumber: 7,
  inTiebreak: true,
  isBreakPoint: true,
  isGamePoint: false,
  isGameEnd: true,
  isSetPoint: false,
  isSetEnd: true,
  isMatchPoint: false,
};

/** A tracked-player serve in, won on a forehand drive that landed deuce deep. */
function point(overrides: Record<string, unknown> = {}) {
  return Point.create({
    id: POINT_ID,
    matchId: MATCH_ID,
    timestamp: 1_700_000_000_000,
    sequence: 3,
    server: "TRACKED",
    courtSide: "DEUCE",
    won: true,
    context: CONTEXT,
    serves: [{ number: 1, outcome: "IN", location: null }],
    returnOutcome: null,
    endReason: "FORCED",
    unusualReason: null,
    unusualNote: null,
    note: null,
    wing: "FOREHAND",
    shotType: "DRIVE",
    ballIn: true,
    ballLocation: { half: "DEUCE", depth: "DEEP" },
    rallyLengthBucket: "B2",
    ...overrides,
  });
}

const NO_CONTACT = { wing: null, shotType: null, ballIn: null, ballLocation: null };

// Every shape the capture flow can commit. The generated Zod schema is the check the
// TypeScript types cannot make: it carries the uuid format and the note's length.
const SHAPES: [string, Record<string, unknown>][] = [
  ["a struck point", {}],
  [
    "an ace",
    { serves: [{ number: 1, outcome: "ACE", location: null }], endReason: "ACE", ...NO_CONTACT },
  ],
  [
    "a second serve in after a fault",
    {
      serves: [
        { number: 1, outcome: "FAULT", location: "LONG" },
        { number: 2, outcome: "IN", location: null },
      ],
    },
  ],
  [
    "a double fault",
    {
      serves: [
        { number: 1, outcome: "FAULT", location: "NET" },
        { number: 2, outcome: "FAULT", location: "WIDE" },
      ],
      endReason: "DOUBLE_FAULT",
      won: false,
      ...NO_CONTACT,
    },
  ],
  [
    "a lone fault whose second serve went unwatched",
    { serves: [{ number: 1, outcome: "FAULT", location: "NET" }] },
  ],
  ["an unwatched serve", { serves: [] }],
  ["an unwatched ending", { endReason: null, ...NO_CONTACT }],
  ["only the winner seen", { serves: [], endReason: null, ...NO_CONTACT }],
  ["a struck point whose final ball went unwatched", { ballIn: null, ballLocation: null }],
  ["a final ball out", { ballIn: false, ballLocation: "LONG" }],
  [
    "an opponent serve returned in",
    {
      server: "OPPONENT",
      serves: [{ number: 1, outcome: "IN", location: null }],
      returnOutcome: "IN",
    },
  ],
  [
    "an opponent serve missed on the return",
    {
      server: "OPPONENT",
      serves: [{ number: 1, outcome: "IN", location: null }],
      returnOutcome: "WIDE",
      endReason: "MISTAKE",
      won: false,
      ...NO_CONTACT,
    },
  ],
  [
    "an opponent double fault",
    {
      server: "OPPONENT",
      serves: [
        { number: 1, outcome: "FAULT", location: null },
        { number: 2, outcome: "FAULT", location: null },
      ],
      endReason: "DOUBLE_FAULT",
      ...NO_CONTACT,
    },
  ],
  [
    "an unusual ending",
    {
      endReason: "UNUSUAL",
      unusualReason: "HINDRANCE",
      unusualNote: "Ball from the next court.",
      ...NO_CONTACT,
    },
  ],
  ["a skipped point", { serves: [], endReason: "UNUSUAL", ...NO_CONTACT }],
  ["a noted point", { note: "Rushed the approach." }],
];

describe("toPointCreate", () => {
  test.each(SHAPES)("produces a body the API's own contract accepts for %s", (_, overrides) => {
    expect(() => zPointCreate.parse(toPointCreate(point(overrides)))).not.toThrow();
  });

  test("sends the id and sequence the point was minted with", () => {
    const body = toPointCreate(point());
    expect(body.id).toBe(POINT_ID);
    expect(body.sequence).toBe(3);
  });

  test("lowercases every enum onto its API member", () => {
    const body = toPointCreate(
      point({
        endReason: "UNUSUAL",
        unusualReason: "BALL_HIT_PLAYER",
        rallyLengthBucket: "B4",
        ...NO_CONTACT,
      }),
    );
    expect(body.server).toBe("tracked");
    expect(body.end_reason).toBe("unusual");
    expect(body.unusual_reason).toBe("ball_hit_player");
    expect(body.rally_length_bucket).toBe("b4");
  });

  // A serve that landed carries no location of its own in the capture model: the box
  // it was aimed at is the side the point was played from.
  test("places a landed serve in the box the point was played from", () => {
    const body = toPointCreate(point({ courtSide: "AD" }));
    expect(body.serve1_outcome).toBe("in");
    expect(body.serve1_box).toBe("ad");
    expect(body.serve1_fault_mode).toBeNull();
    expect(body.serve2_outcome).toBeNull();
  });

  test("splits two attempts across the two serve columns", () => {
    const body = toPointCreate(
      point({
        serves: [
          { number: 1, outcome: "FAULT", location: "LONG" },
          { number: 2, outcome: "IN", location: null },
        ],
      }),
    );
    expect(body.serve1_outcome).toBe("fault");
    expect(body.serve1_box).toBeNull();
    expect(body.serve1_fault_mode).toBe("long");
    expect(body.serve2_outcome).toBe("in");
    expect(body.serve2_box).toBe("deuce");
    expect(body.serve2_fault_mode).toBeNull();
  });

  test("records no placement on an opponent's serve", () => {
    const body = toPointCreate(
      point({
        server: "OPPONENT",
        serves: [
          { number: 1, outcome: "FAULT", location: null },
          { number: 2, outcome: "IN", location: null },
        ],
        returnOutcome: "IN",
      }),
    );
    expect(body.serve1_fault_mode).toBeNull();
    expect(body.serve2_box).toBeNull();
    expect(body.return_outcome).toBe("in");
  });

  // The holes #210 opened: an unwatched serve is no attempt at all, an unwatched
  // ending a null end reason, and both reach the API as null rather than a stand-in.
  test("sends an unwatched serve and ending as null", () => {
    const body = toPointCreate(point({ serves: [], endReason: null, ...NO_CONTACT }));
    expect(body.serve1_outcome).toBeNull();
    expect(body.serve1_box).toBeNull();
    expect(body.end_reason).toBeNull();
    expect(body.wing).toBeNull();
    expect(body.ball_in).toBeNull();
    expect(body.won).toBe(true);
  });

  test("splits a final ball that stayed in over half and depth", () => {
    const body = toPointCreate(point({ ballLocation: { half: "AD", depth: "SHORT" } }));
    expect(body.ball_in).toBe(true);
    expect(body.ball_half).toBe("ad");
    expect(body.ball_depth).toBe("short");
    expect(body.ball_out_mode).toBeNull();
  });

  test("sends a final ball that went out as its failure mode alone", () => {
    const body = toPointCreate(point({ ballIn: false, ballLocation: "WIDE" }));
    expect(body.ball_in).toBe(false);
    expect(body.ball_half).toBeNull();
    expect(body.ball_depth).toBeNull();
    expect(body.ball_out_mode).toBe("wide");
  });

  test("copies all nine score stamps", () => {
    const body = toPointCreate(point());
    expect(body).toMatchObject({
      set_number: 2,
      game_number: 7,
      in_tiebreak: true,
      is_break_point: true,
      is_game_point: false,
      is_game_end: true,
      is_set_point: false,
      is_set_end: true,
      is_match_point: false,
    });
  });

  // The API has one note column for the capture model's two.
  test("folds an unusual point's own note under the general one", () => {
    const unusual = { endReason: "UNUSUAL", unusualReason: "OTHER", ...NO_CONTACT };
    expect(toPointCreate(point()).note).toBeNull();
    expect(toPointCreate(point({ note: "Tight." })).note).toBe("Tight.");
    expect(toPointCreate(point({ ...unusual, unusualNote: "Rain delay." })).note).toBe(
      "Rain delay.",
    );
    expect(
      toPointCreate(point({ ...unusual, note: "Tight.", unusualNote: "Rain delay." })).note,
    ).toBe("Tight.\nRain delay.");
  });

  test("keeps a folded note inside the bound the API enforces", () => {
    const body = toPointCreate(
      point({
        endReason: "UNUSUAL",
        unusualReason: "OTHER",
        note: "x".repeat(NOTE_MAX_LENGTH),
        unusualNote: "y".repeat(10),
        ...NO_CONTACT,
      }),
    );
    expect(body.note).toHaveLength(NOTE_MAX_LENGTH);
    expect(() => zPointCreate.parse(body)).not.toThrow();
  });
});
