/**
 * The live match — the one stateful piece of capture, and the only one that runs.
 *
 * It owns two things and derives the rest: the point being built (`CaptureState`) and
 * the match's event log. The score, who serves, deuce or ad, whether the match is over
 * — all of it is folded from that log by score.ts, never stored.
 *
 * The log holds two kinds of event. A `Point` is one point the coach vouches for, at
 * minimum its winner. A `ScoreCheckpoint` is a scoreboard the coach vouches for, which
 * is how a missed game, a missed set or a wrong scoreboard is recorded — nothing is
 * ever invented to bridge the two. Editing is tail-only: append, or undo the newest
 * event, as often as needed.
 *
 * Two of the flow's steps have no screen: READY commits, and ABORTED restarts the
 * point. The rest is a switch over the step.
 *
 * Nothing here awaits: `outbox.append` is fired and left, per web-capture.md, and the
 * player and coach are handed in as props because the API client may not be imported
 * from this slice at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import * as log from "@/features/outbox/match-log";
import * as outbox from "@/features/outbox/outbox";

import { commitDraft, transition } from "./capture-flow";
import type { CaptureAction, CaptureState } from "./capture-flow";
import { ScoreCheckpoint } from "./checkpoint";
import type { ScoreSnapshot } from "./checkpoint";
import { finalBallZoneRegion } from "./court-geometry";
import { EndingScreen } from "./ending-screen";
import { FinalBallScreen } from "./final-ball-screen";
import { FinalShotScreen } from "./final-shot-screen";
import { Match } from "./match";
import type { MatchEndReason, ScoringSystem, SurfaceType } from "./match";
import { MatchHeader } from "./match-header";
import { MatchSetupScreen } from "./match-setup-screen";
import type { MatchSetupConfig } from "./match-setup-screen";
import { isMatchOver, retireMatch, startNextPoint, undoLast } from "./match-flow";
import { Point } from "./point";
import type { Server } from "./point";
import { RallyLengthScreen } from "./rally-length-screen";
import { ResultScreen } from "./result-screen";
import { ReturnScreen } from "./return-screen";
import {
  contextFor,
  firstServerImpliedBy,
  foldScore,
  interpretSnapshot,
  isCheckpoint,
  matchSetsOf,
} from "./score";
import type { MatchEvent } from "./score";
import { ScoreFlash } from "./score-flash";
import { ScoreSheet } from "./score-sheet";
import { ServeScreen } from "./serve-screen";
import { UnusualPointSheet } from "./unusual-point-sheet";
import { finalWinnerFor } from "./state";

// The court is painted the surface it is played on. Hard and unspecified are absent
// rather than mapped: court-diagram.tsx already falls back to --color-court, so leaving
// the property unset is the same answer with nothing to keep in step.
const COURT_SURFACES: Partial<Record<SurfaceType, string>> = {
  grass: "var(--color-court-grass)",
  clay: "var(--color-court-clay)",
  carpet: "var(--color-court-carpet)",
};

// `played_on` is a calendar date, so it is built from local parts — `toISOString()`
// would date a late-evening match tomorrow east of UTC (see .claude/rules/web.md).
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

export function LiveMatch({
  coachId,
  trackedPlayerId,
  playerName,
  defaultScoringSystem,
  defaultSurfaceType,
  onExit,
  onViewResults,
}: {
  coachId: string;
  trackedPlayerId: string;
  playerName: string;
  // The coach's saved match defaults, forwarded rather than defaulted here — the setup
  // screen owns what a coach who saved none gets.
  defaultScoringSystem?: ScoringSystem;
  defaultSurfaceType?: SurfaceType;
  onExit: () => void;
  onViewResults: (matchId: string) => void;
}) {
  const [match, setMatch] = useState<Match | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [scoreSheetOpen, setScoreSheetOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Never decreases, so an undone sequence is never handed out twice — deriving it
  // from the surviving log would reissue one after an undo.
  const [nextSequence, setNextSequence] = useState(0);
  // The event just committed, held only long enough to flash what it won.
  const [flash, setFlash] = useState<{
    pointId: string;
    won: boolean;
    level: "point" | "game" | "set";
  } | null>(null);
  // Kept so Back into setup returns the coach to what they typed, not a blank form.
  const [setupConfig, setSetupConfig] = useState<MatchSetupConfig | null>(null);
  // The match row goes out just before the first event that needs it. A ref, not
  // state, because a single synchronous pass can queue twice (once directly, again via
  // queue() once READY commits) — a state setter wouldn't be visible to the second
  // call until the next render. Mirrored into matchQueued (state) below purely so
  // render has something reactive to read; render must never read a ref directly.
  const matchQueuedRef = useRef(false);
  const [matchQueued, setMatchQueued] = useState(false);
  // Null until the log has been asked whether this player has a match still running.
  const [restoring, setRestoring] = useState(true);
  // Same ref-plus-state pairing as matchQueued above, and for the same reason: finish()
  // can run twice in one pass, and render needs a reactive copy to read.
  const finishedRef = useRef(false);
  const [finished, setFinished] = useState(false);

  const board = useMemo(() => (match === null ? null : foldScore(match, events)), [match, events]);

  /**
   * Picks up a match this device already has events for — the phone died, the tab was
   * closed, the app updated — and folds the score again from the log rather than from
   * anything held in memory (#119). Nothing here is on the tap path, so it is the one
   * place in capture that awaits.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await log.findInProgressFor(coachId, trackedPlayerId);
        if (cancelled || found === undefined) return;
        const logged = await log.readLog(found.matchId);
        if (cancelled) return;
        const resumed = Match.fromJSON(found.payload);
        const restoredEvents = logged.map((event) =>
          event.kind === "checkpoint"
            ? ScoreCheckpoint.fromJSON(event.payload)
            : Point.fromJSON(event.payload),
        );
        const resumedBoard = foldScore(resumed, restoredEvents);
        setMatch(resumed);
        setEvents(restoredEvents);
        setNextSequence(found.nextSequence);
        // The match row went out with its first event, so Back must not offer setup.
        matchQueuedRef.current = true;
        setMatchQueued(true);
        setCapture(
          isMatchOver(resumed, resumedBoard)
            ? null
            : startNextPoint(resumed, resumedBoard, found.nextSequence),
        );
      } catch {
        // A logged row that won't parse (an older build's payload, a half-written
        // event) must not leave the coach on a blank form wondering: say so, and drop
        // back to setup with nothing half-restored rather than by accident.
        if (cancelled) return;
        setMatch(null);
        setEvents([]);
        setCapture(null);
        setNextSequence(0);
        matchQueuedRef.current = false;
        setMatchQueued(false);
        toast.error("That match could not be reopened on this device. You can start a new one.");
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId, trackedPlayerId]);

  /**
   * The match row, sent once the coach has left the first serve or return screen.
   * Until then Back returns to setup, so the match is still being written: queueing it
   * earlier would send one the coach then edited, and the outbox never rewrites a
   * payload it already holds.
   */
  function queueMatch(current: Match) {
    if (matchQueuedRef.current) return;
    matchQueuedRef.current = true;
    setMatchQueued(true);
    void outbox.append({
      id: current.matchId,
      coachId,
      matchId: current.matchId,
      kind: "match",
      payload: current.toJSON(),
    });
  }

  function queueEvent(current: Match, event: MatchEvent, sequenceAfter: number) {
    queueMatch(current);
    const kind = isCheckpoint(event) ? "checkpoint" : "point";
    void outbox.append({
      id: event.id,
      coachId,
      matchId: current.matchId,
      kind,
      payload: event.toJSON(),
    });
    // Written beside the queue row, never instead of it: the queue is drained and
    // deleted, the log is what the match is folded from next time it opens.
    void log.appendEvent({
      id: event.id,
      matchId: current.matchId,
      coachId,
      sequence: event.sequence,
      kind,
      payload: event.toJSON(),
    });
    void log.saveMatch({
      matchId: current.matchId,
      coachId,
      trackedPlayerId,
      nextSequence: sequenceAfter,
      finished: false,
      updatedAt: Date.now(),
      payload: current.toJSON(),
    });
  }

  /**
   * Finishes the match server-side. Completion is one-way there, so it waits for the
   * coach rather than firing the moment the fold decides the match: until this row is
   * queued the result screen can still undo its way back into the match.
   */
  function finish(current: Match, trackedPlayerWon: boolean, reason: "completed" | MatchEndReason) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);
    queueMatch(current);
    // Finished is what keeps a completed match from being resumed into, and out of
    // the in-progress list the home screen reads.
    void log.saveMatch({
      matchId: current.matchId,
      coachId,
      trackedPlayerId,
      nextSequence,
      finished: true,
      updatedAt: Date.now(),
      payload: current.toJSON(),
    });
    void outbox.append({
      id: `${current.matchId}:outcome`,
      coachId,
      matchId: current.matchId,
      kind: "matchOutcome",
      payload: { reason, trackedPlayerWon },
    });
  }

  /** Runs actions through the flow, then answers the steps that have no screen. */
  function advance(from: CaptureState, actions: readonly CaptureAction[]) {
    if (match === null || board === null) return;
    let next = from;
    for (const action of actions) next = transition(next, action);

    if (next.step.name === "ABORTED") {
      // Only reachable now if something dispatches UNDO with nothing behind it: Back
      // stops offering it (see backAction). The draft is gone, so the point starts over.
      setCapture(startNextPoint(match, board, nextSequence));
      return;
    }

    // Off the serve screen is the moment setup stops being reachable, so it is the
    // moment the match becomes real.
    if (next.step.name !== "SERVE") queueMatch(match);

    if (next.step.name !== "READY") {
      setCapture(next);
      return;
    }

    const won = next.draft.won ?? false;
    const context = contextFor(match, board, next.draft.server, won);
    const point = commitDraft(next.draft, crypto.randomUUID(), Date.now(), context);
    const nextEvents = [...events, point];
    queueEvent(match, point, nextSequence + 1);
    setEvents(nextEvents);
    setNextSequence(nextSequence + 1);

    const after = foldScore(match, nextEvents);
    const over = isMatchOver(match, after);
    // The point that ends the match hands straight over to the result screen, which
    // says who won at greater length — a flash over it is the same news twice.
    if (!over) {
      setFlash({
        pointId: point.id,
        won: point.won,
        level: context.isSetEnd ? "set" : context.isGameEnd ? "game" : "point",
      });
    }
    setCapture(over ? null : startNextPoint(match, after, nextSequence + 1));
  }

  // Stable, so a tap on the screen underneath doesn't restart the flash's own timer.
  const clearFlash = useCallback(() => {
    setFlash(null);
  }, []);

  function dispatch(action: CaptureAction) {
    if (capture !== null) advance(capture, [action]);
  }

  function startMatch(config: MatchSetupConfig) {
    setSetupConfig(config);
    const opponentId = crypto.randomUUID();
    const created = Match.create({
      matchId: crypto.randomUUID(),
      playedOn: today(),
      trackedPlayerId,
      opponentId,
      opponentName: config.opponentName,
      scoringSystem: config.scoringSystem,
      firstServer: config.playerServesFirst ? trackedPlayerId : opponentId,
      surfaceType: config.surfaceType,
      outcomeOverride: null,
    });
    setMatch(created);
    setCapture(startNextPoint(created, foldScore(created, []), 0));
  }

  /**
   * Records the point winner-only, the header's skip. TAP_UNUSUAL is valid from a serve
   * or the final ball, so anything captured past that is stepped back off first rather
   * than half-kept.
   */
  function skipPoint(won: boolean) {
    if (capture === null) return;
    let from = capture;
    while (
      from.step.name !== "SERVE" &&
      from.step.name !== "BALL_LOCATION" &&
      from.history.length > 0
    ) {
      from = transition(from, { type: "UNDO" });
    }
    advance(from, [
      { type: "TAP_UNUSUAL" },
      { type: "TAP_UNUSUAL_OUTCOME", won },
      { type: "TAP_UNUSUAL_REASON", reason: null, note: null },
    ]);
  }

  /**
   * Appends the scoreboard the coach just declared. On an empty log their "serving
   * next" answer also pins who served first — the one moment that is still open, since
   * every point already recorded was captured under the rotation it implies.
   */
  function setScore(entered: { after: ScoreSnapshot; servesNext: Server; orderChanged: boolean }) {
    if (match === null || board === null) return;
    let current = match;

    if (events.length === 0) {
      const read = interpretSnapshot(current, entered.after);
      if (!("problems" in read)) {
        const implied = firstServerImpliedBy(read.board, entered.servesNext);
        const impliedId = implied === "TRACKED" ? current.trackedPlayerId : current.opponentId;
        if (impliedId !== current.firstServer) {
          current = Match.create({ ...current.toJSON(), firstServer: impliedId });
          setMatch(current);
        }
      }
    }

    const checkpoint = ScoreCheckpoint.create({
      id: crypto.randomUUID(),
      matchId: current.matchId,
      timestamp: Date.now(),
      sequence: nextSequence,
      after: entered.after,
      servesNext: entered.servesNext,
      orderChanged: entered.orderChanged,
    });
    const nextEvents = [...events, checkpoint];
    queueEvent(current, checkpoint, nextSequence + 1);
    setEvents(nextEvents);
    setNextSequence(nextSequence + 1);
    setScoreSheetOpen(false);

    const after = foldScore(current, nextEvents);
    setCapture(
      isMatchOver(current, after) ? null : startNextPoint(current, after, nextSequence + 1),
    );
  }

  /**
   * Drops the newest event. Always queues a delete row as well as removing the event's
   * own: a row stays queued from send until the 2xx lands, so "not in the outbox" is
   * not "not on the server", and the delete is idempotent either way.
   */
  function undo() {
    if (match === null) return;
    const { events: remaining, removed } = undoLast(events);
    if (removed === null) return;

    void outbox.remove([removed.id]);
    void log.removeEvent(removed.id);
    void outbox.append({
      id: `${removed.id}:delete`,
      coachId,
      matchId: match.matchId,
      kind: "eventDelete",
      payload: { kind: isCheckpoint(removed) ? "checkpoint" : "point" },
    });

    setEvents(remaining);
    setUndoing(false);
    const after = foldScore(match, remaining);
    setCapture(startNextPoint(match, after, nextSequence));
  }

  function endMatch({
    reason,
    trackedPlayerWon,
  }: {
    reason: MatchEndReason;
    trackedPlayerWon: boolean;
  }) {
    if (match === null) return;
    const winner = trackedPlayerWon ? match.trackedPlayerId : match.opponentId;
    const ended =
      reason === "retirement"
        ? retireMatch(match, trackedPlayerWon ? match.opponentId : match.trackedPlayerId)
        : Match.create({ ...match.toJSON(), outcomeOverride: { reason, winner } });
    // Ending is final — there's no setup to back into from here — so the match must
    // reach the outbox now if an event never did (a walkover/retirement declared off
    // the serve screen). The outcome goes as its own row rather than folded into the
    // match row, which the outbox would never rewrite.
    finish(ended, trackedPlayerWon, reason);
    setMatch(ended);
    setScoreSheetOpen(false);
    setCapture(null);
  }

  // Nothing is drawn until the log has answered: showing setup first would flash a
  // blank form over a match that is about to be resumed.
  if (restoring) return null;

  if (match === null || board === null) {
    return (
      <MatchSetupScreen
        playerName={playerName}
        initial={setupConfig}
        defaultScoringSystem={defaultScoringSystem}
        defaultSurfaceType={defaultSurfaceType}
        onBack={onExit}
        onStart={startMatch}
      />
    );
  }

  const opponentName = match.opponentName ?? "Opponent";

  const newest = events[events.length - 1];
  const undoLabel = newest !== undefined && isCheckpoint(newest) ? "score change" : "last point";
  // Rendered from both the capture screens and the result screen: a mis-tapped match
  // point is undone from exactly the screen it lands on.
  const undoSheet = undoing ? (
    <Sheet open onOpenChange={setUndoing}>
      <SheetContent side="bottom" className="mx-auto max-w-md gap-4 rounded-t-sm p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Undo the {undoLabel}?</SheetTitle>
        </SheetHeader>
        <p className="text-sm text-muted-foreground">
          It comes off the record and the score goes back with it.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setUndoing(false);
            }}
            className="h-13 text-base"
          >
            Keep it
          </Button>
          <Button variant="destructive" onClick={undo} className="h-13 text-base">
            Undo
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  ) : null;

  if (capture === null) {
    // Aliased so the narrowing above survives into the closure below.
    const decided = match;
    const winner = finalWinnerFor(decided, matchSetsOf(board));
    // Leaving the result screen finishes the match too, so a coach who never taps
    // Finish still completes it.
    function finishAndLeave(go: () => void) {
      finish(
        decided,
        winner === decided.trackedPlayerId,
        decided.outcomeOverride?.reason ?? "completed",
      );
      go();
    }
    return (
      <>
        {undoSheet}
        <ResultScreen
          match={match}
          board={board}
          trackedPlayerName={playerName}
          opponentName={opponentName}
          // A match ended by retirement, walkover or default is not a score to unwind.
          onUndo={
            match.outcomeOverride === null && events.length > 0 && !finished
              ? () => {
                  setUndoing(true);
                }
              : null
          }
          onFinish={() => {
            finishAndLeave(onExit);
          }}
          onHome={() => {
            finishAndLeave(onExit);
          }}
          onViewResults={() => {
            finishAndLeave(() => {
              onViewResults(match.matchId);
            });
          }}
        />
      </>
    );
  }

  const { step, draft } = capture;

  // Rally length, ending and final shot all zoom into the region the final ball landed
  // in — set whenever that step commits a CourtZone, and guaranteed non-null by the
  // flow itself once any of those three steps is reached (see capture-flow.ts's
  // BALL_LOCATION case), so the `!` below is asserting an invariant, not guessing one.
  const zoomTo =
    draft.ballLocation !== null && typeof draft.ballLocation === "object"
      ? finalBallZoneRegion(draft.won ?? true, draft.ballLocation)
      : null;

  /**
   * Back goes one screen at a time within the point, and stops at the serve or return
   * screen. Before the match is queued (see queueMatch) it steps out to setup; after,
   * setup is closed for good, so it offers to undo the newest event instead — or, with
   * nothing captured to undo, leaves the match, which is deletable from the match list.
   */
  const backAction =
    capture.history.length > 0
      ? () => {
          dispatch({ type: "UNDO" });
        }
      : !matchQueued
        ? () => {
            setMatch(null);
            setCapture(null);
          }
        : events.length > 0
          ? () => {
              setUndoing(true);
            }
          : onExit;

  return (
    // `display: contents` because custom properties inherit down the DOM tree rather
    // than the box tree: the surface reaches every court below without this wrapper
    // becoming a box that the screens' own flex sizing would then have to account for.
    <div
      className="contents"
      style={{ "--court-surface": COURT_SURFACES[match.surfaceType] } as React.CSSProperties}
    >
      <MatchHeader
        match={match}
        board={board}
        server={draft.server}
        trackedPlayerName={playerName}
        opponentName={opponentName}
        onBack={backAction}
        onEditScore={() => {
          setScoreSheetOpen(true);
        }}
        onSkipPoint={skipPoint}
        onAddNote={(text) => {
          dispatch({ type: "ADD_NOTE", text });
        }}
      />

      {step.name === "SERVE" &&
        (draft.server === "TRACKED" ? (
          <ServeScreen step={step} draft={draft} onAction={dispatch} />
        ) : (
          <ReturnScreen step={step} onAction={dispatch} />
        ))}

      {step.name === "BALL_LOCATION" && (
        <FinalBallScreen
          trackedPlayerName={playerName}
          opponentName={opponentName}
          onAction={dispatch}
        />
      )}

      {step.name === "RALLY_LENGTH" && <RallyLengthScreen zoomTo={zoomTo!} onAction={dispatch} />}

      {step.name === "ENDING" && (
        <EndingScreen
          won={draft.won ?? true}
          zoomTo={zoomTo!}
          trackedPlayerName={playerName}
          opponentName={opponentName}
          onAction={dispatch}
        />
      )}

      {step.name === "SHOT_DETAIL" && <FinalShotScreen zoomTo={zoomTo!} onAction={dispatch} />}

      {(step.name === "UNUSUAL_OUTCOME" || step.name === "UNUSUAL_REASON") && (
        <UnusualPointSheet
          step={step}
          trackedPlayerName={playerName}
          opponentName={opponentName}
          onAction={dispatch}
          onDismiss={() => {
            dispatch({ type: "UNDO" });
          }}
        />
      )}

      {scoreSheetOpen && (
        <ScoreSheet
          match={match}
          board={board}
          hasEvents={events.length > 0}
          trackedPlayerName={playerName}
          opponentName={opponentName}
          onSetScore={setScore}
          onEndMatch={endMatch}
          onDismiss={() => {
            setScoreSheetOpen(false);
          }}
        />
      )}

      {undoSheet}

      {flash !== null && (
        <ScoreFlash key={flash.pointId} level={flash.level} won={flash.won} onDone={clearFlash} />
      )}
    </div>
  );
}
