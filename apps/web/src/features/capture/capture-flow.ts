/**
 * Single-point capture flow — the screen-by-screen state machine a coach steps through
 * to record one point, ending in a committed `Point` or an aborted/reset draft.
 *
 * Not to be confused with `state.ts`'s own "flow layer" (its doc comment already uses
 * that term for a different concern: deriving whether a completed sequence of `Point`s
 * ends a game/set/match). This module decides what screen comes next while *building*
 * one `Point`; `state.ts` decides what a finished sequence of them means. Named
 * `capture-flow.ts` rather than `flow.ts` to keep the two apart.
 *
 * Pure and I/O-free, matching `state.ts`'s functional style rather than `point.ts`'s
 * class style — a draft changes step-by-step and must be undoable, which a class with
 * private mutable fields fights (undo would need deep-cloning instead of popping an
 * already-immutable value off a stack). `transition()` never touches `crypto`, `Date`,
 * or the outbox; the caller supplies `id`/`timestamp` at commit time and appends the
 * result to the outbox itself (see `commitDraft`'s doc comment).
 */

import type {
  CourtSide,
  CourtZone,
  EndReason,
  FailureMode,
  ReturnOutcome,
  RallyBucket,
  PointContext,
  Server,
  ServeAttempt,
  ShotType,
  UnusualReason,
  Wing,
} from "./point";
import { Point } from "./point";

// --- Draft ------------------------------------------------------------------------

/**
 * The in-progress point being built up toward a `Point`. Mirrors `Point`'s own field
 * set (minus `id`/`timestamp`, assigned only at commit) with `won`/`endReason` and
 * every downstream field nullable — unlike `Point`, which is only ever a finished fact.
 * Discarded, not shared, so nothing here needs `Point`'s defensive-copy discipline.
 */
export interface PointDraft {
  matchId: string;
  sequence: number;
  server: Server;
  // Which physical side of the court this point is played from — fixed for the
  // point's whole life, regardless of who serves (see point.ts's own comment on
  // Point.courtSide). The caller's job to derive (via `score.ts`'s
  // `nextCourtSideFor`) and hand in at `startPoint`, not something this module
  // computes.
  courtSide: CourtSide;
  serves: ServeAttempt[];
  returnOutcome: ReturnOutcome | null;
  won: boolean | null;
  endReason: EndReason | null;
  unusualReason: UnusualReason | null;
  // A coach note, added any time during the point via ADD_NOTE — see its own comment
  // in transition() for why it isn't gated to a particular step.
  note: string | null;
  wing: Wing | null;
  shotType: ShotType | null;
  ballIn: boolean | null;
  ballLocation: CourtZone | FailureMode | null;
  rallyLengthBucket: RallyBucket | null;
}

function freshDraft(
  matchId: string,
  sequence: number,
  server: Server,
  courtSide: CourtSide,
): PointDraft {
  return {
    matchId,
    sequence,
    server,
    courtSide,
    serves: [],
    returnOutcome: null,
    won: null,
    endReason: null,
    unusualReason: null,
    note: null,
    wing: null,
    shotType: null,
    ballIn: null,
    ballLocation: null,
    rallyLengthBucket: null,
  };
}

// --- Steps and state ----------------------------------------------------------------

/**
 * Every screen this module can be "on". A single `SERVE` (not separate tracked/
 * opponent members) — the caller renders the tracked-vs-opponent variant from
 * `draft.server`, which never changes across a draft's life; splitting the step would
 * just give the same fact two places to drift apart. `number` distinguishes the first
 * serve from a fault's follow-up second attempt.
 */
export type CaptureStep =
  | { name: "SERVE"; number: 1 | 2 }
  | { name: "BALL_LOCATION" } // where the last good ball finished, which also says who won
  | { name: "UNUSUAL_OUTCOME" } // win/loss — mandatory, the score must stay correct
  | { name: "UNUSUAL_REASON" } // optional, may be skipped
  | { name: "RALLY_LENGTH" }
  | { name: "ENDING" } // forced or unforced
  | { name: "SHOT_DETAIL" }
  | { name: "READY" } // draft complete — caller calls commitDraft
  | { name: "ABORTED" }; // discarded — caller starts a fresh point

export interface CaptureState {
  step: CaptureStep;
  draft: PointDraft;
  // Oldest first. Popped by UNDO — see its own comment below for why a stack is
  // needed rather than re-deriving the prior draft from the step name alone.
  history: readonly { step: CaptureStep; draft: PointDraft }[];
}

/**
 * Starts a new point's capture at the first serve. `courtSide` is the caller's
 * responsibility to derive (via `score.ts`'s `nextCourtSideFor`) and hand in — this
 * module never computes it. Not checked against `server`: it applies the same way
 * regardless of who serves (see point.ts's own comment on Point.courtSide).
 */
export function startPoint(
  matchId: string,
  sequence: number,
  server: Server,
  courtSide: CourtSide,
): CaptureState {
  return {
    step: { name: "SERVE", number: 1 },
    draft: freshDraft(matchId, sequence, server, courtSide),
    history: [],
  };
}

// --- Actions ----------------------------------------------------------------------

export type CaptureAction =
  // Tracked player serving only (never valid for OPPONENT — see TAP_RETURN below).
  // Carries no placement: the capture screen taps the box `draft.courtSide` already
  // fixes, so one tap says the serve landed, never where inside it.
  | { type: "TAP_SERVE_IN" }
  // location required for TRACKED (why it missed), omitted for OPPONENT (out of
  // scope — opponent serve placement, fault or otherwise, is never captured).
  | { type: "TAP_SERVE_FAULT"; location?: FailureMode }
  // Carries no placement either way — see TAP_SERVE_IN.
  | { type: "TAP_SERVE_ACE" }
  // Opponent serving only: there's no separate "serve in" tap the way tracked-serving
  // has one — reaching for "where did the return go" already implies the serve was in.
  // endReason is required exactly when outcome is an error (the coach's forced/mistake
  // read on the return itself); omitted when the return stays in play.
  | { type: "TAP_RETURN"; outcome: ReturnOutcome; endReason?: "FORCED" | "MISTAKE" }
  // Valid from a SERVE or BALL_LOCATION step — see transition()'s own comment on what
  // each origin resets.
  | { type: "TAP_LET" }
  // Valid from a SERVE or BALL_LOCATION step — from a serve, no serve is recorded at all.
  | { type: "TAP_UNUSUAL" }
  // "I didn't see that." Valid on every step that asks for an observation, and the
  // one place the flow stops short without discarding the point: whatever the coach
  // did see is kept, and everything past it stays null. `won` is required exactly on
  // BALL_LOCATION, where the ending is what went unseen and the winner still has to
  // be told.
  | { type: "TAP_DIDNT_SEE"; won?: boolean }
  | { type: "TAP_UNUSUAL_OUTCOME"; won: boolean }
  | { type: "TAP_UNUSUAL_REASON"; reason: UnusualReason | null }
  // The last good ball finished on the loser's half, so the half the coach tapped is
  // also who won. The screen resolves that (it knows which half is drawn where); this
  // module only stores the answer.
  | { type: "TAP_BALL_LOCATION"; won: boolean; ballIn: boolean; location: CourtZone | FailureMode }
  | { type: "TAP_RALLY_LENGTH"; bucket: RallyBucket }
  | { type: "TAP_ENDING"; endReason: "FORCED" | "MISTAKE" }
  | { type: "TAP_SHOT_DETAIL"; wing: Wing; shotType: ShotType }
  // The header's note button — valid on every step, since a note is a supplementary
  // annotation, not part of the tennis flow it's layered over.
  | { type: "ADD_NOTE"; text: string }
  | { type: "UNDO" };

function invalidAction(action: CaptureAction, step: CaptureStep): Error {
  return new Error(`${action.type} is not valid on step ${step.name}`);
}

/** Appends a ServeAttempt for the given serve number, growing draft.serves by one. */
function withServe(draft: PointDraft, attempt: ServeAttempt): PointDraft {
  return { ...draft, serves: [...draft.serves, attempt] };
}

// A second note on the same point lands on a new line rather than overwriting the
// first — see ADD_NOTE's own comment on why this stays a plain string, not a list.
function appendNote(existing: string | null, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return existing;
  return existing === null ? trimmed : `${existing}\n${trimmed}`;
}

// The endings with no rally at all — the flow layer defaults rallyLengthBucket to the
// shortest bucket here rather than asking, since there was nothing to ask about.
// Point.create itself never does this (see point.ts) — it's this module's rule, not a
// stored invariant, and deliberately doesn't extend to UNUSUAL (see TAP_UNUSUAL_REASON).
function readyDraft(
  draft: PointDraft,
  won: boolean,
  endReason: "ACE" | "DOUBLE_FAULT" | "FORCED" | "MISTAKE",
): PointDraft {
  return { ...draft, won, endReason, rallyLengthBucket: "B1" };
}

/**
 * Advances to `nextStep`/`nextDraft`, pushing the current `{step, draft}` onto
 * `history` first. The one place every real transition builds its return value, so a
 * branch can't forget the push (or push the wrong pair) the way eleven separate
 * hand-written `history: [...history, {step, draft}]` call sites could.
 */
function advance(state: CaptureState, nextStep: CaptureStep, nextDraft: PointDraft): CaptureState {
  return {
    step: nextStep,
    draft: nextDraft,
    history: [...state.history, { step: state.step, draft: state.draft }],
  };
}

/**
 * Pure, total, and deterministic: given a state and an action, returns the next state.
 * Every real (non-identity) transition pushes the prior `{step, draft}` onto `history`
 * first, so `UNDO` is a plain pop — see its own case below.
 */
export function transition(state: CaptureState, action: CaptureAction): CaptureState {
  const { step, draft, history } = state;

  if (action.type === "UNDO") {
    const previous = history[history.length - 1];
    if (previous === undefined) {
      // Nothing left to step back into — the whole draft is discarded.
      return { step: { name: "ABORTED" }, draft, history: [] };
    }
    return { ...previous, history: history.slice(0, -1) };
  }

  // Valid on every step, unlike TAP_LET/TAP_UNUSUAL below: a note isn't a scoring
  // action, so there's no "wrong step" to reject it from. Doesn't advance the step
  // or push onto history — an undo shouldn't have to walk back through note-taking
  // to reach real capture progress, and a note about a discarded rally is rightly
  // discarded with the rest of the draft on TAP_LET/UNDO-to-ABORTED, same as every
  // other field here.
  if (action.type === "ADD_NOTE") {
    return { ...state, draft: { ...draft, note: appendNote(draft.note, action.text) } };
  }

  // TAP_LET is context-sensitive by origin step, not by a field on the action itself.
  if (action.type === "TAP_LET") {
    if (step.name === "SERVE") {
      // Service let: nothing was recorded for *this* attempt yet (Let was chosen
      // instead of a court tap), so replaying the same serve number is a no-op —
      // there's nothing to push onto history, because nothing changed. Any prior
      // attempt already in draft.serves (e.g. a first-serve fault, if this is a let
      // on the second serve) survives untouched.
      return state;
    }
    if (step.name === "BALL_LOCATION") {
      // Rally let: replay the whole point from first serve. Full reset, not a partial
      // one — matchId/sequence/server are the only three fields that never change
      // across a draft's life, so rebuilding from just those is exactly "start over."
      // History is cleared, not preserved: the discarded rally is meant to be gone,
      // not something to step back into. courtSide carries over unchanged — it's the
      // same point being replayed, so the court side it's played from doesn't change.
      return startPoint(draft.matchId, draft.sequence, draft.server, draft.courtSide);
    }
    throw invalidAction(action, step);
  }

  if (action.type === "TAP_DIDNT_SEE") {
    if (step.name === "SERVE") {
      // Nothing is recorded for the serve — an unwatched one is absent from `serves`,
      // not a fourth thing a serve can do — and the rally is still ahead.
      return advance(state, { name: "BALL_LOCATION" }, draft);
    }
    if (step.name === "BALL_LOCATION") {
      if (action.won === undefined) {
        throw new Error("TAP_DIDNT_SEE requires won on the ball location step");
      }
      // The ending is what went unseen, so endReason and everything below it stay null.
      return advance(state, { name: "READY" }, { ...draft, won: action.won, endReason: null });
    }
    if (step.name === "SHOT_DETAIL") {
      return advance(state, { name: "READY" }, draft);
    }
    throw invalidAction(action, step);
  }

  if (action.type === "TAP_UNUSUAL") {
    // From a SERVE step nothing is committable yet (no attempt, or a lone fault still
    // awaiting its second), so the attempt in hand is simply not recorded: an unwatched
    // serve is one absent from `serves`, not a fourth thing a serve can do.
    if (step.name !== "SERVE" && step.name !== "BALL_LOCATION") {
      throw invalidAction(action, step);
    }
    return advance(state, { name: "UNUSUAL_OUTCOME" }, draft);
  }

  switch (step.name) {
    case "SERVE": {
      const { number } = step;
      if (action.type === "TAP_SERVE_IN") {
        if (draft.server !== "TRACKED") throw invalidAction(action, step);
        const nextDraft = withServe(draft, { number, outcome: "IN", location: null });
        return advance(state, { name: "BALL_LOCATION" }, nextDraft);
      }
      if (action.type === "TAP_SERVE_ACE") {
        const nextDraft = withServe(draft, { number, outcome: "ACE", location: null });
        // Whoever served it won it: an ace by the tracked player is a point won, an
        // ace against them is a point lost.
        const won = draft.server === "TRACKED";
        return advance(state, { name: "READY" }, readyDraft(nextDraft, won, "ACE"));
      }
      if (action.type === "TAP_SERVE_FAULT") {
        const location = draft.server === "TRACKED" ? (action.location ?? null) : null;
        if (draft.server === "TRACKED" && action.location === undefined) {
          throw new Error("TAP_SERVE_FAULT requires a location when server is TRACKED");
        }
        if (draft.server === "OPPONENT" && action.location !== undefined) {
          throw new Error("TAP_SERVE_FAULT must omit location when server is OPPONENT");
        }
        const nextDraft = withServe(draft, { number, outcome: "FAULT", location });
        if (number === 1) {
          return advance(state, { name: "SERVE", number: 2 }, nextDraft);
        }
        // Second fault: a double fault. The server lost their own service point.
        const won = draft.server !== "TRACKED";
        return advance(state, { name: "READY" }, readyDraft(nextDraft, won, "DOUBLE_FAULT"));
      }
      if (action.type === "TAP_RETURN") {
        if (draft.server !== "OPPONENT") throw invalidAction(action, step);
        // The serve itself was in — there's no separate "serve in" tap on this path,
        // see CaptureAction's own comment on TAP_RETURN.
        const withServeIn = withServe(draft, { number, outcome: "IN", location: null });
        if (action.outcome === "IN") {
          if (action.endReason !== undefined) {
            throw new Error("TAP_RETURN must omit endReason when outcome is IN");
          }
          // A return that stays in play is still a recorded outcome, not the absence
          // of one — analytics counts return_outcome IS NOT NULL as "returns faced".
          return advance(state, { name: "BALL_LOCATION" }, { ...withServeIn, returnOutcome: "IN" });
        }
        if (action.endReason === undefined) {
          throw new Error("TAP_RETURN requires endReason when the return errored");
        }
        // Our player's return missed — the opponent wins the point. returnOutcome
        // already says where it went (net/wide/long), so this takes the same no-rally
        // shortcut as ACE/DOUBLE_FAULT rather than asking shot detail and ball location
        // for a fact already captured.
        const nextDraft = readyDraft(
          { ...withServeIn, returnOutcome: action.outcome },
          false,
          action.endReason,
        );
        return advance(state, { name: "READY" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "BALL_LOCATION": {
      if (action.type === "TAP_BALL_LOCATION") {
        const nextDraft: PointDraft = {
          ...draft,
          won: action.won,
          ballIn: action.ballIn,
          ballLocation: action.location,
        };
        return advance(state, { name: "RALLY_LENGTH" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "UNUSUAL_OUTCOME": {
      if (action.type === "TAP_UNUSUAL_OUTCOME") {
        const nextDraft: PointDraft = { ...draft, won: action.won, endReason: "UNUSUAL" };
        return advance(state, { name: "UNUSUAL_REASON" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "UNUSUAL_REASON": {
      if (action.type === "TAP_UNUSUAL_REASON") {
        const nextDraft: PointDraft = { ...draft, unusualReason: action.reason };
        // rallyLengthBucket is left null, neither asked nor defaulted like ACE/
        // DOUBLE_FAULT: a mid-rally hindrance had a real length, a point penalty had
        // none, and a default either way would corrupt short-rally win-percentage stats.
        return advance(state, { name: "READY" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "RALLY_LENGTH": {
      if (action.type === "TAP_RALLY_LENGTH") {
        const nextDraft: PointDraft = { ...draft, rallyLengthBucket: action.bucket };
        return advance(state, { name: "ENDING" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "ENDING": {
      if (action.type === "TAP_ENDING") {
        const nextDraft: PointDraft = { ...draft, endReason: action.endReason };
        // An unforced error skips the shot: which stroke produced a miss tells a coach
        // less than where it missed, and asking costs a tap on the commonest ending.
        const nextStep: CaptureStep =
          action.endReason === "MISTAKE" ? { name: "READY" } : { name: "SHOT_DETAIL" };
        return advance(state, nextStep, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "SHOT_DETAIL": {
      if (action.type === "TAP_SHOT_DETAIL") {
        const nextDraft: PointDraft = { ...draft, wing: action.wing, shotType: action.shotType };
        return advance(state, { name: "READY" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "READY":
    case "ABORTED":
      throw invalidAction(action, step);
  }
}

// --- Commit -------------------------------------------------------------------------

/**
 * Turns a completed draft into a real `Point`. Kept separate from `transition` (which
 * must stay pure) and does not itself touch the outbox — `id`/`timestamp` are the
 * caller's inputs, same as `append`'s own doc comment describes: a tap handler builds
 * the Point, then calls `outbox.append({..., kind: "point", payload: point.toJSON()})`
 * itself, without awaiting it. Delegates all validation to `Point.create` rather than
 * re-checking the draft here — a bug in `transition` that reaches READY with an
 * incomplete draft surfaces as `Point.create` throwing, not a silent bad commit.
 */
export function commitDraft(
  draft: PointDraft,
  id: string,
  timestamp: number,
  context: PointContext,
): Point {
  return Point.create({ id, timestamp, context, ...draft });
}
