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
  Server,
  ServeAttempt,
  ServeTarget,
  ServeZone,
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
  serves: ServeAttempt[];
  returnOutcome: ReturnOutcome | null;
  won: boolean | null;
  endReason: EndReason | null;
  unusualReason: UnusualReason | null;
  unusualNote: string | null;
  wing: Wing | null;
  shotType: ShotType | null;
  ballIn: boolean | null;
  ballLocation: CourtZone | FailureMode | null;
  rallyLengthBucket: RallyBucket | null;
}

function freshDraft(matchId: string, sequence: number, server: Server): PointDraft {
  return {
    matchId,
    sequence,
    server,
    serves: [],
    returnOutcome: null,
    won: null,
    endReason: null,
    unusualReason: null,
    unusualNote: null,
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
  | { name: "RALLY" }
  | { name: "UNUSUAL_OUTCOME" } // win/loss — mandatory, the score must stay correct
  | { name: "UNUSUAL_REASON" } // optional, may be skipped
  | { name: "SHOT_DETAIL" }
  | { name: "BALL_LOCATION" }
  | { name: "RALLY_LENGTH" }
  | { name: "READY" } // draft complete — caller calls commitDraft
  | { name: "ABORTED" }; // discarded — caller starts a fresh point

export interface CaptureState {
  step: CaptureStep;
  draft: PointDraft;
  // Oldest first. Popped by UNDO — see its own comment below for why a stack is
  // needed rather than re-deriving the prior draft from the step name alone.
  history: readonly { step: CaptureStep; draft: PointDraft }[];
  // Which service box this point is served from — fixed for the point's whole
  // lifetime (deuce/ad doesn't change between a first and second serve attempt, or
  // across a let replay of the same point). Never a tap: it's derived (see
  // `nextBoxFor` in state.ts) before capture even starts, since it's fully
  // predictable from how many points have been played in the current game. Null
  // when the opponent is serving — box only ever describes the tracked player's own
  // serve position (see point.ts).
  box: CourtSide | null;
}

/**
 * Starts a new point's capture at the first serve. `box` is the caller's
 * responsibility to derive (via `state.ts`'s `nextBoxFor`) and required exactly when
 * `server` is `"TRACKED"` — enforced here so a caller can't start a tracked-serving
 * point without it, or hand one in for an opponent-serving point where it would be
 * meaningless.
 */
export function startPoint(
  matchId: string,
  sequence: number,
  server: Server,
  box: CourtSide | null,
): CaptureState {
  if (server === "TRACKED" && box === null) {
    throw new Error("box is required when server is TRACKED");
  }
  if (server === "OPPONENT" && box !== null) {
    throw new Error("box must be null when server is OPPONENT");
  }
  return {
    step: { name: "SERVE", number: 1 },
    draft: freshDraft(matchId, sequence, server),
    history: [],
    box,
  };
}

// --- Actions ----------------------------------------------------------------------

export type CaptureAction =
  // Tracked player serving only (never valid for OPPONENT — see TAP_RETURN below).
  // `target` alone, not a full ServeZone: `box` is already known from CaptureState,
  // derived before capture started, never tapped.
  | { type: "TAP_SERVE_IN"; target: ServeTarget }
  // location required for TRACKED (why it missed), omitted for OPPONENT (out of
  // scope — opponent serve placement, fault or otherwise, is never captured).
  | { type: "TAP_SERVE_FAULT"; location?: FailureMode }
  // target required for TRACKED (combined with CaptureState.box — see TAP_SERVE_IN),
  // omitted for OPPONENT (an ace against the tracked player has no location at all).
  | { type: "TAP_SERVE_ACE"; target?: ServeTarget }
  // Opponent serving only: there's no separate "serve in" tap the way tracked-serving
  // has one — reaching for "where did the return go" already implies the serve was in.
  // endReason is required exactly when outcome is an error (the coach's forced/mistake
  // read on the return itself); omitted when the return stays in play.
  | { type: "TAP_RETURN"; outcome: ReturnOutcome; endReason?: "FORCED" | "MISTAKE" }
  // Valid from a SERVE or RALLY step — see transition()'s own comment on what each
  // origin resets.
  | { type: "TAP_LET" }
  | { type: "TAP_RALLY_OUTCOME"; won: boolean; endReason: "FORCED" | "MISTAKE" }
  // RALLY only, not also SERVE — see transition()'s own comment on why.
  | { type: "TAP_UNUSUAL" }
  | { type: "TAP_UNUSUAL_OUTCOME"; won: boolean }
  | { type: "TAP_UNUSUAL_REASON"; reason: UnusualReason | null; note: string | null }
  | { type: "TAP_SHOT_DETAIL"; wing: Wing; shotType: ShotType }
  | { type: "TAP_BALL_LOCATION"; ballIn: boolean; location: CourtZone | FailureMode }
  | { type: "TAP_RALLY_LENGTH"; bucket: RallyBucket | null }
  | { type: "UNDO" };

function invalidAction(action: CaptureAction, step: CaptureStep): Error {
  return new Error(`${action.type} is not valid on step ${step.name}`);
}

/** Appends a ServeAttempt for the given serve number, growing draft.serves by one. */
function withServe(draft: PointDraft, attempt: ServeAttempt): PointDraft {
  return { ...draft, serves: [...draft.serves, attempt] };
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
    box: state.box,
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
      return { step: { name: "ABORTED" }, draft, history: [], box: state.box };
    }
    return { ...previous, history: history.slice(0, -1), box: state.box };
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
    if (step.name === "RALLY") {
      // Rally let: replay the whole point from first serve. Full reset, not a partial
      // one — matchId/sequence/server are the only three fields that never change
      // across a draft's life, so rebuilding from just those is exactly "start over."
      // History is cleared, not preserved: the discarded rally is meant to be gone,
      // not something to step back into. box carries over unchanged — it's the same
      // point being replayed, so the service box it's played from doesn't change.
      return startPoint(draft.matchId, draft.sequence, draft.server, state.box);
    }
    throw invalidAction(action, step);
  }

  if (action.type === "TAP_UNUSUAL") {
    if (step.name !== "RALLY") {
      // Point.create only ever accepts a serves array that's already a committable
      // shape (one non-fault attempt, or two attempts) — every SERVE step sits in a
      // shape that can't commit on its own (no attempt yet, or a lone fault still
      // awaiting its second attempt), so Unusual only becomes actionable once the
      // serve has resolved into a rally. Narrower than "before a ball is struck" —
      // see the commit message for why.
      throw invalidAction(action, step);
    }
    return advance(state, { name: "UNUSUAL_OUTCOME" }, draft);
  }

  switch (step.name) {
    case "SERVE": {
      const { number } = step;
      if (action.type === "TAP_SERVE_IN") {
        if (draft.server !== "TRACKED") throw invalidAction(action, step);
        if (state.box === null) {
          throw new Error("TAP_SERVE_IN requires CaptureState.box to already be known");
        }
        const location: ServeZone = { box: state.box, target: action.target };
        const nextDraft = withServe(draft, { number, outcome: "IN", location });
        return advance(state, { name: "RALLY" }, nextDraft);
      }
      if (action.type === "TAP_SERVE_ACE") {
        if (draft.server === "TRACKED") {
          if (action.target === undefined) {
            throw new Error("TAP_SERVE_ACE requires a target when server is TRACKED");
          }
          if (state.box === null) {
            throw new Error("TAP_SERVE_ACE requires CaptureState.box to already be known");
          }
          const location: ServeZone = { box: state.box, target: action.target };
          const nextDraft = withServe(draft, { number, outcome: "ACE", location });
          // Aced by the tracked player: they served it, so they won.
          return advance(state, { name: "READY" }, readyDraft(nextDraft, true, "ACE"));
        }
        if (action.target !== undefined) {
          throw new Error("TAP_SERVE_ACE must omit target when server is OPPONENT");
        }
        const nextDraft = withServe(draft, { number, outcome: "ACE", location: null });
        // Aced by the opponent: our player never touched it, so the opponent won.
        return advance(state, { name: "READY" }, readyDraft(nextDraft, false, "ACE"));
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
          return advance(state, { name: "RALLY" }, withServeIn);
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

    case "RALLY": {
      if (action.type === "TAP_RALLY_OUTCOME") {
        const nextDraft: PointDraft = { ...draft, won: action.won, endReason: action.endReason };
        return advance(state, { name: "SHOT_DETAIL" }, nextDraft);
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
        const nextDraft: PointDraft = {
          ...draft,
          unusualReason: action.reason,
          unusualNote: action.note,
        };
        // Deliberately NOT auto-filled, unlike ACE/DOUBLE_FAULT: a mid-rally hindrance
        // had a real length, a point penalty had none, and this flow can't tell which
        // — defaulting either way would corrupt short-rally win-percentage stats.
        return advance(state, { name: "RALLY_LENGTH" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "SHOT_DETAIL": {
      if (action.type === "TAP_SHOT_DETAIL") {
        const nextDraft: PointDraft = { ...draft, wing: action.wing, shotType: action.shotType };
        return advance(state, { name: "BALL_LOCATION" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "BALL_LOCATION": {
      if (action.type === "TAP_BALL_LOCATION") {
        const nextDraft: PointDraft = {
          ...draft,
          ballIn: action.ballIn,
          ballLocation: action.location,
        };
        return advance(state, { name: "RALLY_LENGTH" }, nextDraft);
      }
      throw invalidAction(action, step);
    }

    case "RALLY_LENGTH": {
      if (action.type === "TAP_RALLY_LENGTH") {
        const nextDraft: PointDraft = { ...draft, rallyLengthBucket: action.bucket };
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
export function commitDraft(draft: PointDraft, id: string, timestamp: number): Point {
  return Point.create({ id, timestamp, ...draft });
}
