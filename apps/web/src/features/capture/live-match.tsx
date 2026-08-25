/**
 * The live match — the one stateful piece of capture, and the only one that runs.
 *
 * It owns two things and derives the rest: the point being built (`CaptureState`) and
 * the points already committed. The score, who serves, deuce or ad, whether the match
 * is over — all of it is re-derived from that `Point[]` by state.ts, never stored.
 *
 * Three of the flow's steps have no screen. RALLY_LENGTH is answered from the bucket
 * the rally screen parked, READY commits, and ABORTED restarts the point. The rest is a
 * switch over the step.
 *
 * Nothing here awaits: `outbox.append` is fired and left, per web-capture.md, and the
 * player and coach are handed in as props because the API client may not be imported
 * from this slice at all.
 */

import { useRef, useState } from "react";

import * as outbox from "@/features/outbox/outbox";

import { commitDraft, transition } from "./capture-flow";
import type { CaptureAction, CaptureState } from "./capture-flow";
import { FinalBallScreen } from "./final-ball-screen";
import { FinalShotScreen } from "./final-shot-screen";
import { Match } from "./match";
import type { MatchEndReason, SurfaceType } from "./match";
import { MatchHeader } from "./match-header";
import { MatchSetupScreen } from "./match-setup-screen";
import type { MatchSetupConfig } from "./match-setup-screen";
import { isMatchOver, retireMatch, startNextPoint } from "./match-flow";
import { Point } from "./point";
import type { RallyBucket } from "./point";
import { RallyScreen } from "./rally-screen";
import { ResultScreen } from "./result-screen";
import { ReturnScreen } from "./return-screen";
import { ServeScreen } from "./serve-screen";
import { SkipAheadSheet } from "./skip-ahead-sheet";
import { skipAhead } from "./skip-ahead";
import type { SkipAheadTarget } from "./skip-ahead";
import { UnusualPointSheet } from "./unusual-point-sheet";

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
  onExit,
  onViewResults,
}: {
  coachId: string;
  trackedPlayerId: string;
  playerName: string;
  onExit: () => void;
  onViewResults: (matchId: string) => void;
}) {
  const [match, setMatch] = useState<Match | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  // Asked at the start of the rally, wanted at the end of the point: this is the only
  // thing alive across both (see rally-screen.tsx).
  const [rallyBucket, setRallyBucket] = useState<RallyBucket | null>(null);
  const [skipAheadOpen, setSkipAheadOpen] = useState(false);
  // Kept so Back into setup returns the coach to what they typed, not a blank form.
  const [setupConfig, setSetupConfig] = useState<MatchSetupConfig | null>(null);
  // The match row goes out just before the first point that needs it, so a skip-ahead
  // that reseeds the serve rotation is queued in its final shape — the outbox is
  // first-write-wins and never rewrites a payload.
  const matchQueued = useRef(false);

  /**
   * The match row, sent once the coach has left the first serve or return screen.
   * Until then Back returns to setup, so the match is still being written: queueing it
   * earlier would send one the coach then edited, and the outbox never rewrites a
   * payload it already holds.
   */
  function queueMatch(current: Match) {
    if (matchQueued.current) return;
    matchQueued.current = true;
    void outbox.append({
      id: current.matchId,
      coachId,
      matchId: current.matchId,
      kind: "match",
      payload: current.toJSON(),
    });
  }

  function queue(current: Match, newPoints: readonly Point[]) {
    queueMatch(current);
    for (const point of newPoints) {
      void outbox.append({
        id: point.id,
        coachId,
        matchId: current.matchId,
        kind: "point",
        payload: point.toJSON(),
      });
    }
  }

  /** Runs actions through the flow, then answers the steps that have no screen. */
  function advance(from: CaptureState, actions: readonly CaptureAction[]) {
    if (match === null) return;
    let next = from;
    for (const action of actions) next = transition(next, action);

    if (next.step.name === "RALLY_LENGTH") {
      next = transition(next, { type: "TAP_RALLY_LENGTH", bucket: rallyBucket });
    }

    if (next.step.name === "ABORTED") {
      // Only reachable now if something dispatches UNDO with nothing behind it: Back
      // stops offering it (see backAction). The draft is gone, so the point starts over.
      setCapture(startNextPoint(match, points));
      return;
    }

    // Off the serve screen is the moment setup stops being reachable, so it is the
    // moment the match becomes real.
    if (next.step.name !== "SERVE") queueMatch(match);

    if (next.step.name !== "READY") {
      setCapture(next);
      return;
    }

    const point = commitDraft(next.draft, crypto.randomUUID(), Date.now());
    const nextPoints = [...points, point];
    queue(match, [point]);
    setPoints(nextPoints);
    setRallyBucket(null);
    setCapture(isMatchOver(match, nextPoints) ? null : startNextPoint(match, nextPoints));
  }

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
    setCapture(startNextPoint(created, []));
  }

  /**
   * Records the point winner-only, the header's skip. TAP_UNUSUAL is valid from a serve
   * or a rally, so anything captured past that is stepped back off first rather than
   * half-kept.
   */
  function skipPoint(won: boolean) {
    if (capture === null) return;
    let from = capture;
    while (from.step.name !== "SERVE" && from.step.name !== "RALLY" && from.history.length > 0) {
      from = transition(from, { type: "UNDO" });
    }
    advance(from, [
      { type: "TAP_UNUSUAL" },
      { type: "TAP_UNUSUAL_OUTCOME", won },
      { type: "TAP_UNUSUAL_REASON", reason: null, note: null },
    ]);
  }

  function skipToScore(target: SkipAheadTarget) {
    if (match === null) return;
    const result = skipAhead(match, target, () => crypto.randomUUID(), Date.now());
    queue(result.match, result.points);
    setMatch(result.match);
    setPoints(result.points);
    setSkipAheadOpen(false);
    setCapture(
      isMatchOver(result.match, result.points) ? null : startNextPoint(result.match, result.points),
    );
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
    setMatch(ended);
    setSkipAheadOpen(false);
    setCapture(null);
  }

  if (match === null) {
    return <MatchSetupScreen playerName={playerName} initial={setupConfig} onStart={startMatch} />;
  }

  const opponentName = match.opponentName ?? "Opponent";

  if (capture === null) {
    return (
      <ResultScreen
        match={match}
        points={points}
        trackedPlayerName={playerName}
        opponentName={opponentName}
        onHome={onExit}
        onViewResults={() => {
          onViewResults(match.matchId);
        }}
      />
    );
  }

  const { step, draft } = capture;

  /**
   * Back goes one screen at a time within the point, and stops at the serve or return
   * screen: a point already committed is not unwound. On the match's very first screen
   * there is nothing captured yet, so it steps out to setup instead. Null on a later
   * point's first screen, where there is nowhere to go and no button to offer.
   */
  const backAction =
    capture.history.length > 0
      ? () => {
          dispatch({ type: "UNDO" });
        }
      : points.length === 0
        ? () => {
            setMatch(null);
            setCapture(null);
          }
        : null;

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
        points={points}
        server={draft.server}
        trackedPlayerName={playerName}
        opponentName={opponentName}
        onBack={backAction}
        onSkipPoint={skipPoint}
        onSkipAhead={() => {
          setSkipAheadOpen(true);
        }}
      />

      {step.name === "SERVE" &&
        (draft.server === "TRACKED" ? (
          <ServeScreen step={step} draft={draft} onAction={dispatch} />
        ) : (
          <ReturnScreen step={step} onAction={dispatch} />
        ))}

      {step.name === "RALLY" && (
        <RallyScreen
          rallyBucket={rallyBucket}
          onRallyBucketChange={setRallyBucket}
          onAction={dispatch}
        />
      )}

      {step.name === "SHOT_DETAIL" && <FinalShotScreen onAction={dispatch} />}

      {step.name === "BALL_LOCATION" && (
        <FinalBallScreen won={draft.won ?? true} onAction={dispatch} />
      )}

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

      {skipAheadOpen && (
        <SkipAheadSheet
          trackedPlayerName={playerName}
          opponentName={opponentName}
          onSkipToScore={skipToScore}
          onEndMatch={endMatch}
          onDismiss={() => {
            setSkipAheadOpen(false);
          }}
        />
      )}
    </div>
  );
}
